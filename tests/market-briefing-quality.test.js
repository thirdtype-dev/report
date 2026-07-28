const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const moduleCache = new Map();

async function importBriefingModule(phase = 'post_market') {
  if (moduleCache.has(phase)) {
    return moduleCache.get(phase);
  }
  process.env.REPORT_LLM_MOCK = '1';
  process.env.PRESERVE_EXISTING_REPORTS = '0';
  process.env.BRIEFING_PHASE = phase;
  const moduleUrl = `${pathToFileURL(path.join(repoRoot, 'scripts/generate-market-briefing.mjs')).href}?phase=${phase}`;
  const module = await import(moduleUrl);
  moduleCache.set(phase, module);
  return module;
}

function currentDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

test('market briefing preserves the existing complete session when a rerun loses all source coverage', async () => {
  const module = await importBriefingModule();
  const badResearch = {
    investorFlows: {
      status: 'unavailable',
      markets: [],
      reason: 'KOSPI:no_investor_flow_data_within_14_days:empty_pykrx_dataframe'
    },
    investorFlowNewsCandidates: [
      {
        title: '코스피 외국인 기관 순매수 순매도 뉴스 수집 실패',
        summary: 'fetch_failed_503',
        status: 'unavailable'
      }
    ],
    sectorThemeNewsCandidates: [
      {
        title: '오늘 강세 업종 약세 업종 코스피 코스닥 뉴스 수집 실패',
        summary: 'fetch_failed_503',
        status: 'unavailable'
      }
    ],
    stockNewsCandidates: [
      {
        title: '오늘 특징주 급등 급락 코스피 코스닥 뉴스 수집 실패',
        summary: 'fetch_failed_503',
        status: 'unavailable'
      }
    ]
  };

  const plan = module.__testResolveBriefingPublishPlan({
    marketResearch: badResearch,
    report: { marketSummary: { summary: '코스피가 하락했습니다.' } },
    existingHtml: `<article class="report report-post-market">
      <div class="eyebrow published">장마감 브리핑</div>
      <h1>${currentDateKey()} 16:00</h1>
      <h2>② 투자자별 수급 동향</h2>
      <p>뉴스 기준 외국인은 순매도세를 보였습니다.</p>
      <h2>③ 업종별/테마별 흐름</h2>
      <p>반도체 업종이 강세를 보였다는 보도가 있습니다.</p>
    </article>`
  });

  assert.equal(plan.action, 'preserve_existing');
  assert.deepEqual(plan.issues, [
    'sector_theme_source_unavailable',
    'notable_stock_source_unavailable'
  ]);
});

test('market briefing fails instead of publishing placeholder copy when no complete session exists', async () => {
  const module = await importBriefingModule();
  const research = {
    investorFlows: {
      status: 'ok',
      markets: [{ market: 'KOSPI', netBuy: { foreign: -100000000, institution: 200000000, retail: -100000000 } }]
    },
    investorFlowNewsCandidates: [],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 강세', summary: '반도체 업종이 강세를 보였습니다.' }
    ],
    stockNewsCandidates: [
      { title: '네이버 상승', summary: '네이버가 상승했습니다.' },
      { title: '대동기어 하락', summary: '대동기어가 하락했습니다.' }
    ]
  };
  const badReport = {
    marketSummary: {
      kospi: '8,203.84 (▼ 9.99%)',
      kosdaq: '891.52 (▼ 7.94%)',
      summary: '코스피와 코스닥이 급락했습니다.'
    },
    investorFlows: {
      foreign: '외국인 투자자 수급 데이터는 수집되지 않았습니다.',
      institution: '기관 투자자 수급 데이터는 수집되지 않았습니다.',
      retail: '개인 투자자 수급 데이터는 수집되지 않았습니다.'
    },
    sectorThemes: {
      strong: '반도체 업종 강세',
      weak: '일부 업종 약세'
    },
    notableStocks: {
      surging: ['네이버 상승', '펄어비스 상승'],
      plunging: ['대동기어 하락', '이노스페이스 하락']
    },
    tomorrowStrategy: {
      outlook: '수급 확인이 필요합니다.',
      checklist: ['외국인 수급 확인']
    }
  };

  assert.throws(
    () => module.__testResolveBriefingPublishPlan({
      marketResearch: research,
      report: badReport,
      existingHtml: '<article class="report report-post-market"><h1>2026-01-01 16:00</h1></article>'
    }),
    /briefing_quality_gate_failed:placeholder_copy/
  );
});

test('market briefing removes news-basis boilerplate from visible copy', async () => {
  const module = await importBriefingModule();
  const cleaned = module.__testSanitizeBriefingCopy({
    marketSummary: {
      summary: '뉴스 기준, 코스피가 반등했습니다.'
    },
    investorFlows: {
      foreign: '뉴스 기준, 전일 외국인은 코스피에서 순매도한 것으로 나타났습니다.',
      institution: '보도 기준, 기관도 순매도했습니다.',
      retail: '개인은 순매수했습니다.'
    },
    tomorrowStrategy: {
      checklist: ['뉴스 기준, 외국인 수급 확인', '환율 확인']
    }
  });

  const serialized = JSON.stringify(cleaned);
  assert.equal(serialized.includes('뉴스 기준'), false);
  assert.equal(serialized.includes('보도 기준'), false);
  assert.equal(cleaned.investorFlows.foreign, '전일 외국인은 코스피에서 순매도한 것으로 나타났습니다.');
  assert.equal(cleaned.tomorrowStrategy.checklist[0], '외국인 수급 확인');
});

test('post-market briefing fails when investor flow copy describes the previous day', async () => {
  const module = await importBriefingModule();
  const research = {
    generatedAt: '2026-06-24T07:05:40.339Z',
    investorFlows: {
      status: 'unavailable',
      generatedAt: '2026-06-24T16:05:40+09:00',
      markets: [],
      reason: 'empty_pykrx_dataframe'
    },
    investorFlowNewsCandidates: [
      {
        title: '코스피, 외국인·기관 순매도에 8800선 하회',
        summary: '전일 코스피 수급 기사입니다.',
        publishedAt: 'Tue, 23 Jun 2026 01:55:34 GMT'
      }
    ],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 강세', summary: '반도체 업종이 강세를 보였습니다.' }
    ],
    stockNewsCandidates: [
      { title: '삼성전자 상승', summary: '삼성전자가 상승했습니다.' },
      { title: 'LG전자 하락', summary: 'LG전자가 하락했습니다.' }
    ]
  };

  assert.throws(
    () => module.__testResolveBriefingPublishPlan({
      marketResearch: research,
      report: {
        marketSummary: { kospi: '8,471.02 (▲3.26%)', kosdaq: '909.31 (▲2.00%)', summary: '코스피와 코스닥이 상승 마감했습니다.' },
        investorFlows: {
          foreign: '전일 외국인은 코스피에서 순매도한 것으로 나타났습니다.',
          institution: '전일 기관도 코스피에서 순매도한 것으로 나타났습니다.',
          retail: '전일 개인은 코스피에서 순매수한 것으로 나타났습니다.'
        },
        sectorThemes: { strong: '화장품·유통 업종 강세', weak: '반도체 업종 약세' },
        notableStocks: { surging: ['삼성전자 상승', 'SK하이닉스 상승'], plunging: ['LG전자 하락', 'SK스퀘어 하락'] },
        tomorrowStrategy: { outlook: '반도체 업종의 지속성을 확인해야 합니다.', checklist: ['수급 확인', '환율 확인', '미국 증시 확인'] }
      },
      existingHtml: ''
    }),
    /briefing_quality_gate_failed:stale_investor_flow_copy/
  );
});

test('post-market briefing fails when split investor flow sentences describe the previous day', async () => {
  const module = await importBriefingModule();
  const research = {
    investorFlows: {
      status: 'ok',
      markets: [{ market: 'KOSPI', netBuy: { foreign: -100000000, institution: -200000000, retail: 300000000 } }]
    },
    investorFlowNewsCandidates: [],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 약세', summary: '반도체 업종이 약세를 보였습니다.' }
    ],
    stockNewsCandidates: [
      { title: '삼성전자 상승', summary: '삼성전자가 상승했습니다.' },
      { title: 'LG전자 하락', summary: 'LG전자가 하락했습니다.' }
    ]
  };

  assert.throws(
    () => module.__testResolveBriefingPublishPlan({
      marketResearch: research,
      report: {
        marketSummary: { kospi: '7,246.79 (▼5.35%)', kosdaq: '785.00 (▼5.56%)', summary: '코스피와 코스닥이 급락했습니다.' },
        investorFlows: {
          foreign: '외국인은 최근 순매도 기조를 이어가며 지수 하락을 주도했습니다. 전일에는 삼성전자에 대해 1조8000억원 규모의 순매도가 확인됐습니다.',
          institution: '기관도 순매도에 동참했습니다.',
          retail: '개인은 순매수에 나섰습니다.'
        },
        sectorThemes: { strong: '인프라 업종 강세', weak: '반도체 업종 약세' },
        notableStocks: { surging: ['삼성전자 상승', 'SK하이닉스 상승'], plunging: ['LG전자 하락', 'SK스퀘어 하락'] },
        tomorrowStrategy: { outlook: '외국인 수급을 확인해야 합니다.', checklist: ['수급 확인', '환율 확인', '미국 증시 확인'] }
      },
      existingHtml: ''
    }),
    /briefing_quality_gate_failed:stale_investor_flow_copy/
  );
});

test('post-market briefing omits the investor-flow section when current structured flows are unavailable', async () => {
  const module = await importBriefingModule();
  const marketResearch = {
    investorFlows: {
      status: 'unavailable',
      markets: [],
      reason: 'KOSPI:no_investor_flow_data_within_14_days:empty_pykrx_dataframe'
    },
    investorFlowNewsCandidates: [
      { title: '외국인 순매도 관련 뉴스', summary: '외국인 수급 관련 보도입니다.' }
    ],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 약세', summary: '반도체 업종이 약세를 보였습니다.' }
    ],
    stockNewsCandidates: [
      { title: '삼성전자 상승', summary: '삼성전자가 상승했습니다.' },
      { title: 'LG전자 하락', summary: 'LG전자가 하락했습니다.' }
    ]
  };
  const report = {
    marketSummary: { kospi: '7,246.79 (▼5.35%)', kosdaq: '785.00 (▼5.56%)', summary: '코스피와 코스닥이 급락했습니다.' },
    investorFlows: {
      foreign: '외국인은 최근 순매도 기조를 이어가며 지수 하락을 주도했습니다. 전일에는 삼성전자에 대해 1조8000억원 규모의 순매도가 확인됐습니다.',
      institution: '기관도 순매도에 동참했습니다.',
      retail: '개인은 순매수에 나섰습니다.'
    },
    sectorThemes: { strong: '인프라 업종 강세', weak: '반도체 업종 약세' },
    notableStocks: { surging: ['삼성전자 상승', 'SK하이닉스 상승'], plunging: ['LG전자 하락', 'SK스퀘어 하락'] },
    tomorrowStrategy: { outlook: '외국인 수급을 확인해야 합니다.', checklist: ['수급 확인', '환율 확인', '미국 증시 확인'] }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.equal(JSON.stringify(prepared).includes('전일'), false);
  assert.equal(prepared.investorFlows, null);
  assert.equal(
    module.__testResolveBriefingPublishPlan({
      marketResearch,
      report: prepared,
      existingHtml: ''
    }).action,
    'publish_new'
  );
  const rendered = module.__testRenderPostMarketReport(prepared);
  assert.equal(rendered.includes('투자자별 수급 동향'), false);
  assert.equal(rendered.includes('확정 전'), false);
  assert.match(rendered, /<h2>② 업종별\/테마별 흐름<\/h2>/);
});

test('post-market briefing omits model copy when structured flows are stale or incomplete', async () => {
  const module = await importBriefingModule();
  const report = {
    investorFlows: {
      foreign: '외국인은 순매수했습니다.',
      institution: '기관은 순매도했습니다.',
      retail: '개인은 순매도했습니다.'
    }
  };
  const staleResearch = {
    investorFlows: {
      status: 'ok',
      markets: [
        { market: 'KOSPI', latestDate: '2026-01-01', netBuy: { foreign: 1, institution: -1, retail: -1 } },
        { market: 'KOSDAQ', latestDate: '2026-01-01', netBuy: { foreign: 1, institution: -1, retail: -1 } }
      ]
    }
  };
  const partialResearch = {
    investorFlows: {
      status: 'partial',
      markets: [
        { market: 'KOSPI', latestDate: currentDateKey(), netBuy: { foreign: 1, institution: -1, retail: -1 } }
      ]
    }
  };

  assert.equal(module.__testPrepareReportForPublish(staleResearch, report).investorFlows, null);
  assert.equal(module.__testPrepareReportForPublish(partialResearch, report).investorFlows, null);
});

test('post-market briefing keeps investor-flow copy only with complete current KOSPI and KOSDAQ values', async () => {
  const module = await importBriefingModule();
  const marketResearch = {
    investorFlows: {
      status: 'ok',
      markets: [
        { market: 'KOSPI', latestDate: currentDateKey(), netBuy: { foreign: 1, institution: -1, retail: -1 } },
        { market: 'KOSDAQ', latestDate: currentDateKey(), netBuy: { foreign: 2, institution: -2, retail: 0 } }
      ]
    }
  };
  const report = {
    investorFlows: {
      foreign: '외국인은 양 시장 합산 순매수했습니다.',
      institution: '기관은 양 시장 합산 순매도했습니다.',
      retail: '개인은 혼조를 보였습니다.'
    }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.deepEqual(prepared.investorFlows, report.investorFlows);
  assert.equal(module.__testHasCurrentPostMarketInvestorFlows(marketResearch.investorFlows), true);
  assert.match(module.__testRenderPostMarketReport({
    ...prepared,
    marketSummary: {},
    sectorThemes: {},
    notableStocks: { surging: [], plunging: [] },
    tomorrowStrategy: { checklist: [] }
  }), /투자자별 수급 동향/);
});

test('writer quality validation routes placeholder copy to fallback before publish planning', async () => {
  const module = await importBriefingModule();
  const marketResearch = {
    investorFlows: {
      status: 'ok',
      markets: [
        { market: 'KOSPI', latestDate: currentDateKey(), netBuy: { foreign: -322600000000, institution: 1131400000000, retail: -772300000000 } },
        { market: 'KOSDAQ', latestDate: currentDateKey(), netBuy: { foreign: -160100000000, institution: 582500000000, retail: -424500000000 } }
      ]
    }
  };

  assert.throws(
    () => module.__testPrepareAndValidateWriterReport(marketResearch, {
      investorFlows: {
        foreign: '외국인 수급 데이터는 수집되지 않았습니다.',
        institution: '기관 수급 데이터는 수집되지 않았습니다.',
        retail: '개인 수급 데이터는 수집되지 않았습니다.'
      }
    }),
    /briefing_writer_quality_failed:placeholder_copy/
  );

  const accepted = module.__testPrepareAndValidateWriterReport(marketResearch, {
    investorFlows: {
      foreign: '외국인은 KOSPI 3,226억원, KOSDAQ 1,601억원 순매도했습니다.',
      institution: '기관은 KOSPI 1조1,314억원, KOSDAQ 5,825억원 순매수했습니다.',
      retail: '개인은 KOSPI 7,723억원, KOSDAQ 4,245억원 순매도했습니다.'
    }
  });

  assert.match(accepted.investorFlows.foreign, /KOSPI 3,226억원/);
});

test('post-market quality gate rejects unavailable-flow prose regardless of exact wording', async () => {
  const module = await importBriefingModule();
  const marketResearch = {
    investorFlows: { status: 'unavailable', markets: [] },
    investorFlowNewsCandidates: [{ title: '당일 수급 기사', summary: '수급 기사입니다.' }],
    sectorThemeNewsCandidates: [{ title: '반도체 강세', summary: '반도체 업종이 강세였습니다.' }],
    stockNewsCandidates: [
      { title: 'A 상승', summary: 'A가 상승했습니다.' },
      { title: 'B 하락', summary: 'B가 하락했습니다.' }
    ]
  };

  assert.throws(
    () => module.__testResolveBriefingPublishPlan({
      marketResearch,
      report: {
        marketSummary: { summary: '증시가 상승했습니다.' },
        investorFlows: {
          foreign: '외국인 수급은 아직 공개 대기 상태입니다.',
          institution: '기관 수급은 집계 중입니다.',
          retail: '개인 수급은 미확정입니다.'
        },
        sectorThemes: { strong: '반도체 강세', weak: '일부 약세' },
        notableStocks: { surging: ['A', 'C'], plunging: ['B', 'D'] },
        tomorrowStrategy: { outlook: '변동성을 확인합니다.', checklist: ['수급', '환율', '미국 증시'] }
      },
      existingHtml: ''
    }),
    /briefing_quality_gate_failed:.*unavailable_investor_flow_copy.*unverified_investor_flow_copy/
  );
});

test('post-market briefing does not preserve an existing article with stale investor flow copy', async () => {
  const module = await importBriefingModule();
  const badResearch = {
    investorFlows: {
      status: 'unavailable',
      markets: [],
      reason: 'empty_pykrx_dataframe'
    },
    investorFlowNewsCandidates: [
      {
        title: '코스피 외국인 기관 순매수 순매도 뉴스 수집 실패',
        summary: 'fetch_failed_503',
        status: 'unavailable'
      }
    ],
    sectorThemeNewsCandidates: [
      { title: '오늘 강세 업종 약세 업종 코스피 코스닥 뉴스 수집 실패', summary: 'fetch_failed_503', status: 'unavailable' }
    ],
    stockNewsCandidates: [
      { title: '오늘 특징주 급등 급락 코스피 코스닥 뉴스 수집 실패', summary: 'fetch_failed_503', status: 'unavailable' }
    ]
  };

  assert.throws(
    () => module.__testResolveBriefingPublishPlan({
      marketResearch: badResearch,
      report: { marketSummary: { summary: '코스피가 상승했습니다.' } },
      existingHtml: `<article class="report report-post-market">
        <div class="eyebrow published">장마감 브리핑</div>
        <h1>${currentDateKey()} 16:00</h1>
        <h2>② 투자자별 수급 동향</h2>
        <p>전일 외국인은 코스피에서 순매도한 것으로 나타났습니다.</p>
      </article>`
    }),
    /briefing_quality_gate_failed:/
  );
});

test('pre-market briefing allows prior-session investor-flow watch copy', async () => {
  const module = await importBriefingModule('pre_market');
  const research = {
    investorFlows: {
      status: 'unavailable',
      markets: [],
      reason: 'market_not_open_yet'
    },
    investorFlowNewsCandidates: [
      {
        title: '코스피, 외국인 순매도에 하락',
        summary: '전 거래일 외국인 순매도가 지수 부담으로 작용했습니다.',
        publishedAt: 'Wed, 24 Jun 2026 07:00:00 GMT'
      }
    ],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 강세', summary: '반도체 업종이 강세를 보였습니다.' }
    ],
    disclosureNewsCandidates: [
      { title: 'A사 공급계약 공시', summary: '전일 장 마감 후 공급계약 공시가 확인됐습니다.' }
    ],
    scheduleNewsCandidates: [
      { title: '오늘 주요 증시 일정', summary: '신규상장과 보호예수 해제 일정이 예정되어 있습니다.' }
    ]
  };

  const plan = module.__testResolveBriefingPublishPlan({
    marketResearch: research,
    report: {
      openingStrategy: {
        keywords: '외국인 수급, 반도체, 공시',
        oneLineStrategy: '외국인 수급 부담과 반도체 강세를 함께 확인해야 합니다.',
        expectedOpen: '전일 하락 이후 보합권 출발 가능성이 있습니다.'
      },
      investorFlowWatch: {
        continuity: '전일 외국인은 코스피에서 순매도한 것으로 나타났습니다.',
        keyInvestor: '외국인 수급이 핵심 변수입니다.',
        checkPoint: '장 초반 외국인 매도 지속 여부를 확인해야 합니다.'
      },
      sectorWeather: {
        sunny: '반도체 업종 강세',
        cloudy: '대형주 혼조',
        rainy: '코스닥 변동성'
      },
      disclosuresAndNews: {
        corporateDisclosure: '공급계약 공시가 확인됐습니다.',
        majorNews: '반도체 업종 강세가 이어졌습니다.',
        schedule: '신규상장과 보호예수 해제 일정이 예정되어 있습니다.'
      },
      watchlist: {
        leaders: '반도체 대형주',
        technicals: '전일 하락 이후 지지선 확인',
        eventDriven: '공급계약 공시 종목'
      }
    },
    existingHtml: ''
  });

  assert.equal(plan.action, 'publish_new');
  assert.deepEqual(plan.issues, []);
});

test('writer retries an incomplete report shape instead of failing the publish immediately', async () => {
  const module = await importBriefingModule();

  assert.equal(
    module.__testIsTransientLlmError(new Error('invalid_report_shape:notableStocks.surging')),
    true
  );
  assert.equal(
    module.__testIsTransientLlmError(new Error('briefing_quality_gate_failed:placeholder_copy')),
    false
  );
});
