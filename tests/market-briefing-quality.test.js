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

test('writer quality validation rejects placeholder copy before publish planning', async () => {
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

test('pre-market briefing omits unsupported disclosure and schedule copy instead of preserving a stale report', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    investorFlows: {
      status: 'ok',
      markets: [{ market: 'KOSPI' }]
    },
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 변동성 확대', summary: '반도체 업종 변동성이 확대됐습니다.' }
    ],
    disclosureNewsCandidates: [],
    scheduleNewsCandidates: []
  };
  const report = {
    openingStrategy: {
      keywords: '반도체 변동성',
      oneLineStrategy: '반도체 위험을 우선 확인합니다.',
      expectedOpen: '변동성 확대가 예상됩니다.'
    },
    investorFlowWatch: {
      continuity: '외국인 수급을 확인합니다.',
      keyInvestor: '외국인이 핵심입니다.',
      checkPoint: '장 초반 매매 방향을 확인합니다.'
    },
    sectorWeather: {
      sunny: '방어주 상대 강세',
      cloudy: '대형주 혼조',
      rainy: '반도체 변동성 확대'
    },
    disclosuresAndNews: {
      corporateDisclosure: '근거 없는 공시 문구',
      majorNews: '반도체 변동성 확대',
      schedule: '근거 없는 일정 문구'
    },
    watchlist: {
      leaders: '방어주 수급 확인',
      technicals: '지수 지지선 확인',
      eventDriven: '반도체 변동성 확인'
    }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);
  const plan = module.__testResolveBriefingPublishPlan({
    marketResearch,
    report: prepared,
    existingHtml: ''
  });
  const html = module.__testRenderPreMarketReport(prepared);

  assert.equal(prepared.disclosuresAndNews.corporateDisclosure, null);
  assert.equal(prepared.disclosuresAndNews.schedule, null);
  assert.equal(prepared.disclosuresAndNews.majorNews, '반도체 변동성 확대');
  assert.equal(plan.action, 'publish_new');
  assert.deepEqual(plan.issues, []);
  assert.equal(html.includes('기업 공시'), false);
  assert.equal(html.includes('주요 일정'), false);
  assert.equal(html.includes('주요 뉴스'), true);
});

test('pre-market writer repairs blank cloudy and rainy weather fields from market-event evidence', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    marketEventConclusions: [
      {
        direction: 'negative',
        primaryTarget: { label: '건설·부동산' },
        headline: '건설 업종 약세',
        score: 12
      },
      {
        direction: 'positive',
        primaryTarget: { label: '반도체' },
        headline: '반도체 업종 강세',
        score: 10
      }
    ]
  };
  const report = {
    openingStrategy: {
      keywords: '기존 키워드',
      oneLineStrategy: '기존 전략',
      expectedOpen: '기존 출발 전망'
    },
    investorFlowWatch: {
      continuity: '기존 연속성',
      keyInvestor: '기존 핵심 투자자',
      checkPoint: '기존 체크포인트'
    },
    sectorWeather: {
      sunny: '기존 강세 날씨',
      cloudy: '  ',
      rainy: ''
    },
    disclosuresAndNews: {
      corporateDisclosure: '기존 공시',
      majorNews: '기존 주요 뉴스',
      schedule: '기존 일정'
    },
    watchlist: {
      leaders: '기존 주도주',
      technicals: '기존 기술적 포인트',
      eventDriven: '기존 이벤트'
    }
  };

  const repaired = module.__testRepairPreMarketWriterReport(marketResearch, report);

  assert.equal(repaired.sectorWeather.sunny, report.sectorWeather.sunny);
  assert.match(repaired.sectorWeather.cloudy, /반도체 업종 강세/);
  assert.match(repaired.sectorWeather.cloudy, /건설 업종 약세/);
  assert.equal(repaired.sectorWeather.rainy, '건설·부동산 - 건설 업종 약세');
  assert.equal(report.sectorWeather.cloudy, '  ');
  assert.doesNotThrow(() => module.__testValidateReportShape(repaired));
});

test('pre-market writer fills a broader incomplete report only from supplied evidence and preserves non-empty fields', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    marketEventConclusions: [
      {
        direction: 'positive',
        primaryTarget: { label: '반도체' },
        headline: '반도체 업종 강세',
        score: 11
      },
      {
        direction: 'negative',
        primaryTarget: { label: '건설·부동산' },
        headline: '건설 업종 약세',
        score: 9
      }
    ],
    investorFlowNewsCandidates: [
      { title: '외국인 순매수 전환', summary: '외국인 수급이 개선됐습니다.' }
    ],
    majorIndices: [
      { title: 'KOSPI', currentPrice: '2,700.00', changePercent: '-0.30%' }
    ],
    disclosureNewsCandidates: [
      { title: 'A사 공급계약 공시', summary: '대규모 계약을 발표했습니다.' }
    ],
    scheduleNewsCandidates: [
      { title: '오늘 신규상장 일정', summary: '신규 상장이 예정돼 있습니다.' }
    ],
    stockNewsCandidates: [
      { title: '삼성전자 상승', summary: '반도체 업황 기대가 반영됐습니다.' }
    ]
  };
  const report = {
    openingStrategy: { keywords: '보존 키워드', oneLineStrategy: '', expectedOpen: '' },
    investorFlowWatch: { continuity: '', keyInvestor: '보존 핵심 투자자', checkPoint: '' },
    sectorWeather: { sunny: '', cloudy: '', rainy: '보존 약세 날씨' },
    disclosuresAndNews: { corporateDisclosure: '', majorNews: '', schedule: '' },
    watchlist: { leaders: '', technicals: '', eventDriven: '' }
  };

  const repaired = module.__testRepairPreMarketWriterReport(marketResearch, report);

  assert.equal(repaired.openingStrategy.keywords, '보존 키워드');
  assert.equal(repaired.investorFlowWatch.keyInvestor, '보존 핵심 투자자');
  assert.equal(repaired.sectorWeather.rainy, '보존 약세 날씨');
  assert.match(repaired.openingStrategy.oneLineStrategy, /반도체 업종 강세/);
  assert.match(repaired.openingStrategy.expectedOpen, /KOSPI 2,700\.00 -0\.30%/);
  assert.match(repaired.investorFlowWatch.continuity, /외국인 순매수 전환/);
  assert.match(repaired.investorFlowWatch.checkPoint, /외국인/);
  assert.match(repaired.disclosuresAndNews.corporateDisclosure, /A사 공급계약 공시/);
  assert.match(repaired.disclosuresAndNews.schedule, /오늘 신규상장 일정/);
  assert.match(repaired.watchlist.leaders, /삼성전자 상승/);
  assert.match(repaired.watchlist.technicals, /KOSPI 2,700\.00/);
  assert.match(repaired.watchlist.eventDriven, /반도체 업종 강세/);
  assert.doesNotThrow(() => module.__testValidateReportShape(repaired));
});

test('pre-market writer leaves an ungrounded required field for strict validation to reject', async () => {
  const module = await importBriefingModule('pre_market');
  const report = {
    openingStrategy: { keywords: '키워드', oneLineStrategy: '전략', expectedOpen: '출발' },
    investorFlowWatch: { continuity: '연속성', keyInvestor: '핵심 투자자', checkPoint: '체크포인트' },
    sectorWeather: { sunny: '강세', cloudy: '혼조', rainy: '' },
    disclosuresAndNews: { corporateDisclosure: '공시', majorNews: '주요 뉴스', schedule: '일정' },
    watchlist: { leaders: '주도주', technicals: '기술적 포인트', eventDriven: '이벤트' }
  };

  const repaired = module.__testRepairPreMarketWriterReport({ marketNews: [] }, report);

  assert.equal(repaired.sectorWeather.rainy, '');
  assert.throws(
    () => module.__testValidateReportShape(repaired),
    /invalid_report_shape:sectorWeather\.rainy/
  );
});

test('news ranking removes stale candidates and orders the remaining articles by publication time', async () => {
  const module = await importBriefingModule('pre_market');
  const referenceTime = Date.parse('2026-07-27T23:35:32.392Z');
  const ranked = module.__testRankFreshNewsCandidates([
    {
      title: '나흘 이전 반도체 강세 기사',
      publishedAt: 'Thu, 23 Jul 2026 01:01:00 GMT',
      sourceUrl: 'https://example.com/stale'
    },
    {
      title: 'CXMT 상장으로 국내 반도체 수익성 하방 우려',
      publishedAt: 'Mon, 27 Jul 2026 07:24:00 GMT',
      sourceUrl: 'https://example.com/cxmt'
    },
    {
      title: '중국발 반도체 우려에 삼성전자 5%·SK하이닉스 7% 하락',
      publishedAt: 'Mon, 27 Jul 2026 23:23:00 GMT',
      sourceUrl: 'https://example.com/premarket'
    }
  ], 10, referenceTime);

  assert.deepEqual(
    ranked.map((item) => item.sourceUrl),
    ['https://example.com/premarket', 'https://example.com/cxmt']
  );
});

test('general market-event engine separates FX downside, bio upside, and oil mixed impact', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-29T00:40:00.000Z',
    disclosureNewsCandidates: [{ title: 'A사 실적 공시', summary: 'A사가 실적을 공시했습니다.' }],
    scheduleNewsCandidates: [{ title: '오늘 상장 일정', summary: '신규 상장이 예정돼 있습니다.' }],
    marketEventNewsCandidates: [
      {
        title: '원/달러 환율 4% 급등에 코스피 급락',
        summary: '원화 약세와 외국인 이탈이 국내 증시에 부담으로 작용했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:30:00 GMT',
        source: 'FX News A',
        sourceUrl: 'https://example.com/fx-a'
      },
      {
        title: '환율 급등·외국인 매도에 국내 증시 약세',
        summary: '코스피와 코스닥이 동반 하락했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:25:00 GMT',
        source: 'FX News B',
        sourceUrl: 'https://example.com/fx-b'
      },
      {
        title: '임상 3상 성공에 바이오주 12% 급등',
        summary: '신약 임상 성공으로 제약·바이오 업종이 강세를 보였습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:20:00 GMT',
        source: 'Bio News',
        sourceUrl: 'https://example.com/bio'
      },
      {
        title: '국제유가 급등에도 정유주 강세',
        summary: '유가 상승은 시장 비용 부담이지만 정유 업종에는 수혜로 작용했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:15:00 GMT',
        source: 'Energy News',
        sourceUrl: 'https://example.com/oil'
      }
    ]
  };
  const signals = module.__testBuildMarketEventSignals(marketResearch);
  const fxSignal = signals.find((signal) => signal.primaryTarget.key === 'fx');
  const bioSignal = signals.find((signal) => signal.primaryTarget.key === 'bio');
  const oilSignal = signals.find((signal) => signal.primaryTarget.key === 'energy');
  const report = {
    openingStrategy: {
      keywords: '업종별 차별화',
      oneLineStrategy: '강세 업종을 확인합니다.',
      expectedOpen: '보합 출발 예상'
    },
    investorFlowWatch: {
      continuity: '외국인 수급을 확인합니다.',
      keyInvestor: '외국인',
      checkPoint: '장 초반 매매 방향을 확인합니다.'
    },
    sectorWeather: {
      sunny: '금융 강세',
      cloudy: '업종 혼조',
      rainy: '일부 종목 약세'
    },
    disclosuresAndNews: {
      corporateDisclosure: 'A사 실적 공시',
      majorNews: '업종별 차별화',
      schedule: '오늘 상장 일정'
    },
    watchlist: {
      leaders: '바이오 주도주',
      technicals: '지수 지지선',
      eventDriven: '환율 민감주'
    }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.equal(fxSignal.direction, 'negative');
  assert.equal(fxSignal.severity, 'high');
  assert.ok(fxSignal.corroboration >= 2);
  assert.equal(bioSignal.direction, 'positive');
  assert.equal(bioSignal.severity, 'high');
  assert.equal(oilSignal.direction, 'mixed');
  assert.equal(oilSignal.severity, 'high');
  assert.match(prepared.openingStrategy.expectedOpen, /하락 출발 가능성.*높은 변동성/);
  assert.match(prepared.sectorWeather.rainy, /원\/달러 환율/);
  assert.match(prepared.sectorWeather.sunny, /바이오·제약/);
  assert.match(prepared.sectorWeather.cloudy, /에너지/);
  assert.match(prepared.disclosuresAndNews.majorNews, /하방:.*상방:.*혼조:/);
});

test('general market-event engine treats tariff shock as a broad factor without losing the automobile target', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-29T00:40:00.000Z',
    disclosureNewsCandidates: [{ title: '완성차 실적 공시', summary: '완성차 기업이 실적을 공시했습니다.' }],
    scheduleNewsCandidates: [{ title: '무역 협상 일정', summary: '무역 협상이 예정돼 있습니다.' }],
    marketEventNewsCandidates: [
      {
        title: '미국 관세 인상에 자동차주 급락',
        summary: '수출 비용 부담으로 완성차 업종 투자심리가 악화했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:30:00 GMT',
        source: 'Trade News A',
        sourceUrl: 'https://example.com/tariff-a'
      },
      {
        title: '보복관세 확대 우려에 자동차·부품주 약세',
        summary: '무역분쟁 확대가 국내 수출주에 부담으로 작용했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:20:00 GMT',
        source: 'Trade News B',
        sourceUrl: 'https://example.com/tariff-b'
      }
    ]
  };
  const report = {
    openingStrategy: { keywords: '수출주', oneLineStrategy: '수출주 반등을 봅니다.', expectedOpen: '강보합 출발 예상' },
    investorFlowWatch: { continuity: '외국인 수급', keyInvestor: '외국인', checkPoint: '선물 수급' },
    sectorWeather: { sunny: '자동차 강세 전환', cloudy: '대형주 혼조', rainy: '건설 약세' },
    disclosuresAndNews: { corporateDisclosure: '완성차 실적 공시', majorNews: '수출 회복', schedule: '무역 협상 일정' },
    watchlist: { leaders: '자동차 주도주 후보', technicals: '지수', eventDriven: '관세 민감주' }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.match(prepared.openingStrategy.keywords, /자동차.*관세·무역.*하방 위험/);
  assert.match(prepared.openingStrategy.expectedOpen, /하락 출발 가능성/);
  assert.equal(prepared.sectorWeather.sunny.includes('자동차 강세 전환'), false);
  assert.match(prepared.watchlist.leaders, /주도주 추격보다 하방 위험/);
});

test('general market-event engine does not promote a single foreign stock move into the domestic market outlook', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-29T00:40:00.000Z',
    marketEventNewsCandidates: [
      {
        title: '[美증시 특징주] 테라다인 실적 발표 후 시간외 18% 급등',
        summary: '테라다인 개별 종목의 실적 호조가 확인됐습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:30:00 GMT',
        source: 'US Stock News',
        sourceUrl: 'https://example.com/teradyne'
      }
    ]
  };

  const signals = module.__testBuildMarketEventSignals(marketResearch);
  const state = module.__testMarketEventState(marketResearch);

  assert.equal(signals[0].primaryTarget.scope, 'stock');
  assert.equal(signals[0].severity, 'high');
  assert.deepEqual(state.positive, []);
  assert.deepEqual(state.negative, []);
});

test('general market-event ranking reserves room for market factors when stock headlines dominate', async () => {
  const module = await importBriefingModule('pre_market');
  const stockEvents = Array.from({ length: 12 }, (_, index) => ({
    title: `개별기업${index + 1} 실적 호조에 15% 급등`,
    summary: `개별기업${index + 1}의 개별 종목 재료입니다.`,
    publishedAt: 'Wed, 29 Jul 2026 00:35:00 GMT',
    source: `Stock News ${index + 1}`,
    sourceUrl: `https://example.com/stock-${index + 1}`
  }));
  const signals = module.__testBuildMarketEventSignals({
    generatedAt: '2026-07-29T00:40:00.000Z',
    marketEventNewsCandidates: [
      ...stockEvents,
      {
        title: '미국 국채금리 부담에 성장주 투자심리 위축',
        summary: '금리 부담이 국내 성장주에도 영향을 줄 수 있습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:30:00 GMT',
        source: 'Rates News',
        sourceUrl: 'https://example.com/rates'
      }
    ]
  });

  assert.ok(signals.some((signal) => signal.primaryTarget.key === 'rates'));
  assert.ok(signals.filter((signal) => signal.primaryTarget.scope === 'stock').length <= 11);
});

test('market-event conclusions let corroborated direct downside outrank an ambiguous question headline', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-29T01:10:00.000Z',
    marketEventNewsCandidates: [
      {
        title: '美반도체주 투매 지속…마이크론·SK하이닉스 ADR 9% 급락',
        summary: '미국 반도체주 약세가 국내 반도체 투자심리에 부담으로 작용했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 01:00:00 GMT',
        source: 'Downside News A',
        sourceUrl: 'https://example.com/semiconductor-down-a'
      },
      {
        title: '반도체주 급락 지속…삼성전자·SK하이닉스 약세',
        summary: '반도체 업종 전반에 매도세가 이어졌습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:55:00 GMT',
        source: 'Downside News B',
        sourceUrl: 'https://example.com/semiconductor-down-b'
      },
      {
        title: '반도체 가격 폭등은 보조금 재검토 탓일까?',
        summary: '공급망 병목이 반도체 가격에 미칠 영향을 분석했습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:50:00 GMT',
        source: 'Analysis News',
        sourceUrl: 'https://example.com/semiconductor-question'
      }
    ]
  };
  const signals = module.__testBuildMarketEventSignals(marketResearch);
  const conclusions = module.__testResolveMarketEventSignals(signals);
  const semiconductorSignals = signals.filter((signal) => signal.primaryTarget.key === 'semiconductor');
  const conclusion = conclusions.find((signal) => signal.primaryTarget.key === 'semiconductor');
  const report = {
    openingStrategy: { keywords: '반도체', oneLineStrategy: '반도체 반등을 봅니다.', expectedOpen: '강보합 예상' },
    investorFlowWatch: { continuity: '외국인 수급', keyInvestor: '외국인', checkPoint: '선물 수급' },
    sectorWeather: { sunny: '반도체 강세', cloudy: '반도체 혼조', rainy: '건설 약세' },
    disclosuresAndNews: { corporateDisclosure: '실적 공시', majorNews: '반도체 가격 상승', schedule: '실적 발표' },
    watchlist: { leaders: '반도체 주도주', technicals: '지수', eventDriven: '실적주' }
  };
  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.deepEqual(
    new Set(semiconductorSignals.map((signal) => signal.direction)),
    new Set(['negative', 'positive'])
  );
  assert.equal(
    semiconductorSignals.find((signal) => signal.direction === 'positive').direct,
    false
  );
  assert.equal(
    semiconductorSignals.find((signal) => signal.direction === 'positive').severity,
    'medium'
  );
  assert.equal(conclusion.direction, 'negative');
  assert.equal(conclusion.confidence, 'high');
  assert.equal(conclusion.resolutionReason, 'dominant_direct_price');
  assert.match(conclusion.counterEvidence.join(' '), /보조금 재검토 탓일까/);
  assert.match(prepared.sectorWeather.rainy, /반도체/);
  assert.equal(prepared.sectorWeather.sunny.includes('반도체'), false);
  assert.equal(prepared.sectorWeather.cloudy.includes('반도체'), false);
  assert.equal(prepared.disclosuresAndNews.majorNews.includes('상방:'), false);
});

test('market-event conclusions keep evenly matched direct opposition in one mixed bucket', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-29T01:10:00.000Z',
    marketEventNewsCandidates: [
      {
        title: '2차전지주 수주 호조에 8% 급등',
        summary: '배터리 업종이 강세를 보였습니다.',
        publishedAt: 'Wed, 29 Jul 2026 01:00:00 GMT',
        source: 'Battery News A',
        sourceUrl: 'https://example.com/battery-up'
      },
      {
        title: '2차전지주 수요 둔화 우려에 8% 급락',
        summary: '배터리 업종이 약세를 보였습니다.',
        publishedAt: 'Wed, 29 Jul 2026 00:59:00 GMT',
        source: 'Battery News B',
        sourceUrl: 'https://example.com/battery-down'
      }
    ]
  };
  const signals = module.__testBuildMarketEventSignals(marketResearch);
  const conclusion = module.__testResolveMarketEventSignals(signals)
    .find((signal) => signal.primaryTarget.key === 'secondary_battery');
  const state = module.__testMarketEventState(marketResearch);

  assert.equal(conclusion.direction, 'mixed');
  assert.equal(conclusion.confidence, 'medium');
  assert.equal(conclusion.resolutionReason, 'conflicting_evidence');
  assert.deepEqual(state.negative, []);
  assert.deepEqual(state.positive, []);
  assert.equal(state.mixed.length, 1);
});

test('writer prompt uses the general market-event model without semiconductor-only instructions', async () => {
  const module = await importBriefingModule('pre_market');
  const prompt = module.__testBuildPrompt({
    marketEventNewsCandidates: [],
    marketEventSignals: []
  });

  assert.match(prompt, /모든 최신 뉴스에서 대상, 방향, 범위, 강도/);
  assert.match(prompt, /marketEventConclusions.*최종 방향/);
  assert.match(prompt, /최종 방향에 해당하는 날씨 한 곳에만 배치/);
  assert.match(prompt, /업종 사건을 전체 지수 방향으로 과장/);
  assert.match(prompt, /"openingStrategy"/);
  assert.equal(prompt.includes('semiconductorRiskNewsCandidates'), false);
  assert.equal(prompt.includes('삼성전자·SK하이닉스 직접 하락'), false);
});

test('general market-event guard corrects the July 28 semiconductor contradiction', async () => {
  const module = await importBriefingModule('pre_market');
  const marketResearch = {
    generatedAt: '2026-07-27T23:35:32.392Z',
    marketEventNewsCandidates: [
      {
        title: '중국 최대 D램 업체 CXMT 상장…한국 반도체 업계 영향은?',
        summary: '삼성전자와 SK하이닉스에 D램 공급 증가, 가격 하락, 수익성 하방 압력으로 작용할 수 있습니다.',
        publishedAt: 'Mon, 27 Jul 2026 07:24:00 GMT',
        sourceUrl: 'https://example.com/cxmt'
      },
      {
        title: '중국발 반도체 우려에…프리마켓서 삼성전자 5%·SK하이닉스 7%↓',
        summary: '중국발 반도체 경쟁 심화 우려와 미국 기술주 급락이 투자심리를 눌렀습니다.',
        publishedAt: 'Mon, 27 Jul 2026 23:23:00 GMT',
        sourceUrl: 'https://example.com/premarket'
      }
    ]
  };
  const report = {
    openingStrategy: {
      keywords: '외국인 순매도, 반도체 강세',
      oneLineStrategy: '반도체 업종의 강세 전환 가능성에 주목해야 합니다.',
      expectedOpen: '약보합 출발 예상'
    },
    sectorWeather: {
      sunny: '반도체 업종이 강세를 보일 전망입니다.',
      cloudy: '코스닥은 혼조가 예상됩니다.',
      rainy: '일부 개별주 변동성이 예상됩니다.'
    },
    disclosuresAndNews: {
      corporateDisclosure: '주요 공시를 확인합니다.',
      majorNews: 'AI 투자 흐름을 확인합니다.',
      schedule: '주요 실적 발표가 예정되어 있습니다.'
    },
    watchlist: {
      leaders: 'SK하이닉스, 삼성전기',
      technicals: '지수 지지선을 확인합니다.',
      eventDriven: '실적 발표 종목을 확인합니다.'
    }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);
  const serialized = JSON.stringify(prepared);

  assert.match(prepared.openingStrategy.expectedOpen, /반도체 중심 약세.*높은 변동성/);
  assert.match(prepared.openingStrategy.oneLineStrategy, /반도체:.*하방 위험/);
  assert.match(prepared.watchlist.leaders, /주도주 추격보다 하방 위험/);
  assert.equal(serialized.includes('약보합'), false);
  assert.equal(serialized.includes('강세 전환 가능성'), false);
  assert.equal(serialized.includes('반도체 업종이 강세를 보일 전망'), false);
});

test('general market-event guard does not promote an old direct decline into a new opening alert', async () => {
  const module = await importBriefingModule('pre_market');
  const report = {
    openingStrategy: {
      keywords: '실적 발표',
      oneLineStrategy: '당일 수급을 확인해야 합니다.',
      expectedOpen: '보합권 출발 예상'
    },
    sectorWeather: { sunny: '자동차 강세', cloudy: '반도체 혼조', rainy: '건설 약세' },
    disclosuresAndNews: { corporateDisclosure: '실적 공시', majorNews: '주요 일정', schedule: '실적 발표' },
    watchlist: { leaders: '자동차', technicals: '지수', eventDriven: '실적주' }
  };

  const prepared = module.__testPrepareReportForPublish({
    generatedAt: '2026-07-27T23:35:32.392Z',
    disclosureNewsCandidates: [
      { title: '실적 공시', summary: '실적 공시가 발표됐습니다.' }
    ],
    scheduleNewsCandidates: [
      { title: '실적 발표 일정', summary: '실적 발표가 예정돼 있습니다.' }
    ],
    marketEventNewsCandidates: [
      {
        title: '삼성전자·SK하이닉스 급락',
        summary: '미국 반도체주 약세가 영향을 줬습니다.',
        publishedAt: 'Fri, 24 Jul 2026 06:00:00 GMT',
        sourceUrl: 'https://example.com/old-decline'
      }
    ]
  }, report);

  assert.deepEqual(prepared, report);
});

test('post-market general event guard reflects semiconductor downside without stock-specific injection', async () => {
  const module = await importBriefingModule();
  const marketResearch = {
    generatedAt: '2026-07-28T07:05:31.476Z',
    investorFlows: { status: 'unavailable', markets: [] },
    marketEventNewsCandidates: [
      {
        title: '중국발 반도체 우려에 삼성전자 13%·SK하이닉스 14% 급락',
        summary: 'CXMT 공급 확대와 미국 엔비디아·마이크론 약세가 반도체 투자심리를 위축시켰습니다.',
        publishedAt: 'Tue, 28 Jul 2026 06:30:00 GMT',
        sourceUrl: 'https://example.com/close'
      }
    ]
  };
  const report = {
    marketSummary: { summary: '글로벌 변동성 확대로 시장이 하락했습니다.' },
    investorFlows: {
      foreign: '외국인은 순매도했습니다.',
      institution: '기관은 순매수했습니다.',
      retail: '개인은 순매수했습니다.'
    },
    sectorThemes: { strong: '반도체 기술적 반등', weak: '주력 업종 약세' },
    notableStocks: {
      surging: ['인트론바이오 상승', 'LG전자 상승'],
      plunging: ['대한전선 하락', '이수페타시스 하락']
    },
    tomorrowStrategy: {
      outlook: '기술적 반등 가능성을 확인합니다.',
      checklist: ['외국인 수급', '환율', '미국 증시']
    }
  };

  const prepared = module.__testPrepareReportForPublish(marketResearch, report);

  assert.equal(prepared.investorFlows, null);
  assert.match(prepared.marketSummary.summary, /반도체.*중국발 반도체 우려/);
  assert.match(prepared.sectorThemes.weak, /반도체.*중국발 반도체 우려/);
  assert.equal(prepared.sectorThemes.strong.includes('반도체'), false);
  assert.deepEqual(prepared.notableStocks.plunging, ['대한전선 하락', '이수페타시스 하락']);
});

test('writer retries an incomplete report shape instead of failing the publish immediately', async () => {
  const module = await importBriefingModule();

  assert.equal(
    module.__testIsTransientLlmError(new Error('invalid_report_shape:notableStocks.surging')),
    true
  );
  assert.equal(
    module.__testIsTransientLlmError(new Error('openrouter_invalid_json_response')),
    true
  );
  assert.equal(
    module.__testIsTransientLlmError(new Error('empty_llm_response')),
    true
  );
  const writerQualityError = new Error('briefing_writer_quality_failed:placeholder_copy');
  writerQualityError.code = 'briefing_writer_quality_failed';
  assert.equal(
    module.__testIsTransientLlmError(writerQualityError),
    true
  );
  assert.equal(
    module.__testIsTransientLlmError(new Error('briefing_quality_gate_failed:placeholder_copy')),
    false
  );
});
