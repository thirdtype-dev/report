const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const moduleCache = new Map();

const reports = {
  post_market: {
    marketSummary: {
      kospi: '2,700.00 (▲ 1.00%)',
      kosdaq: '800.00 (▼ 0.50%)',
      summary: '지수는 업종별 차별화 속에 마감했습니다.'
    },
    investorFlows: {
      foreign: '순매수 우위입니다.',
      institution: '기관은 업종별 차익 실현을 보였습니다.',
      retail: '개인은 일부 성장주를 순매수했습니다.'
    },
    sectorThemes: {
      strong: '반도체가 강세였습니다.',
      weak: '건설은 약세였습니다.'
    },
    notableStocks: {
      surging: ['A 상승', 'B 상승'],
      plunging: ['C 하락', 'D 하락']
    },
    tomorrowStrategy: {
      outlook: '환율과 외국인 수급을 확인합니다.',
      checklist: ['환율', '선물', '거래량']
    }
  },
  pre_market: {
    openingStrategy: {
      keywords: '반도체, 환율',
      oneLineStrategy: '거래대금이 붙는 업종을 확인합니다.',
      expectedOpen: '혼조 출발을 예상합니다.'
    },
    investorFlowWatch: {
      continuity: '외국인 수급 연속성을 확인합니다.',
      keyInvestor: '외국인을 확인합니다.',
      checkPoint: '선물 포지션을 확인합니다.'
    },
    sectorWeather: {
      sunny: '반도체 강세를 확인합니다.',
      cloudy: '금융은 방향성을 확인합니다.',
      rainy: '건설은 변동성을 확인합니다.'
    },
    disclosuresAndNews: {
      corporateDisclosure: '공급계약 공시를 확인합니다.',
      majorNews: '시장 변동성 요인을 확인합니다.',
      schedule: '신규 상장 일정을 확인합니다.'
    },
    watchlist: {
      leaders: '반도체 대형주를 확인합니다.',
      technicals: '거래량을 확인합니다.',
      eventDriven: '공시 종목을 확인합니다.'
    }
  }
};

function response(body, status = 200) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return serialized;
    }
  };
}

function completion(phase, content, overrides = {}) {
  return {
    choices: [{
      finish_reason: 'stop',
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(content) }
    }],
    model: 'deepseek/deepseek-v4-flash',
    provider: 'mock-provider',
    usage: { prompt_tokens: 21, completion_tokens: 34, total_tokens: 55 },
    ...overrides,
    phase
  };
}

async function importWriterModule(phase) {
  if (moduleCache.has(phase)) return moduleCache.get(phase);
  process.env.REPORT_LLM_MOCK = '1';
  process.env.PRESERVE_EXISTING_REPORTS = '0';
  process.env.LLM_RETRY_BASE_DELAY_MS = '0';
  process.env.BRIEFING_PHASE = phase;
  const moduleUrl = `${pathToFileURL(path.join(repoRoot, 'scripts/generate-market-briefing.mjs')).href}?writer-tests=${phase}`;
  const module = await import(moduleUrl);
  moduleCache.set(phase, module);
  return module;
}

function walkSchema(schema, example) {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(example));
  assert.deepEqual(Object.keys(schema.properties), Object.keys(example));
  for (const [key, value] of Object.entries(example)) {
    const child = schema.properties[key];
    if (Array.isArray(value)) {
      assert.equal(child.type, 'array');
      assert.equal(child.minItems, value.length);
      assert.deepEqual(child.items, { type: 'string' });
    } else if (value && typeof value === 'object') {
      walkSchema(child, value);
    } else if (value === null) {
      assert.deepEqual(child, { type: ['string', 'null'] });
    } else {
      assert.deepEqual(child, { type: 'string' });
    }
  }
}

async function withMutedLogs(callback) {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const info = [];
  const warn = [];
  console.info = (...args) => info.push(args);
  console.warn = (...args) => warn.push(args);
  try {
    return await callback({ info, warn });
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

test('OpenRouter request locks the phase schema and reliability preferences for both phases', async () => {
  for (const phase of ['pre_market', 'post_market']) {
    const module = await importWriterModule(phase);
    const request = module.__testBuildOpenRouterBriefingRequest('prompt', 'deepseek/deepseek-v4-flash');
    assert.equal(request.model, 'deepseek/deepseek-v4-flash');
    assert.equal(request.temperature, 0.35);
    assert.equal(request.max_tokens, 8192);
    assert.deepEqual(request.provider, { require_parameters: true, sort: 'latency' });
    assert.deepEqual(request.reasoning, { enabled: false });
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(request.response_format.json_schema.strict, true);
    walkSchema(request.response_format.json_schema.schema, module.__testReportSchema());
    assert.match(module.__testBuildPrompt({}), /모든 키를 반드시 포함/);
    assert.match(module.__testBuildPrompt({}), /문자열 항목과 배열 원소는 문자열/);
  }
});

test('OpenRouter accepts schema-valid responses and logs compact metadata without content', async () => {
  for (const phase of ['pre_market', 'post_market']) {
    const module = await importWriterModule(phase);
    const payload = completion(phase, reports[phase]);
    let requestBody;
    const result = await withMutedLogs(async ({ info }) => {
      const report = await module.__testCallOpenRouter('secret prompt', {
        apiKey: 'secret-key',
        now: (() => {
          let clock = 100;
          return () => (clock += 7);
        })(),
        fetchImpl: async (_url, init) => {
          requestBody = JSON.parse(init.body);
          return response(payload);
        }
      });
      assert.deepEqual(report, reports[phase]);
      const log = info.find(([label]) => label === '[market-briefing] writer response');
      assert.ok(log);
      assert.deepEqual(log[1], {
        provider: 'mock-provider',
        model: 'deepseek/deepseek-v4-flash',
        finishReason: 'stop',
        promptTokens: 21,
        completionTokens: 34,
        totalTokens: 55,
        elapsedMs: 7
      });
      assert.doesNotMatch(JSON.stringify(log), /secret prompt|secret-key|지수는/);
    });
    assert.equal(requestBody.response_format.json_schema.schema.type, 'object');
    assert.equal(requestBody.response_format.json_schema.schema.additionalProperties, false);
  }
});

test('empty, malformed, and finish-length responses are retryable and bounded', async () => {
  const module = await importWriterModule('post_market');
  const cases = [
    {
      name: 'empty',
      body: { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
      expected: /empty_llm_response/
    },
    {
      name: 'malformed',
      body: { choices: [{ finish_reason: 'stop', message: { content: '{"marketSummary":' } }] },
      expected: /openrouter_invalid_json_response/
    },
    {
      name: 'prefixed',
      body: { choices: [{ finish_reason: 'stop', message: { content: '[시장 브리핑] 08:30 {"marketSummary":{}}' } }] },
      expected: /openrouter_invalid_json_response/
    },
    {
      name: 'truncated',
      body: {
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify(reports.post_market) } }]
      },
      expected: /openrouter_truncated_response/
    }
  ];

  for (const testCase of cases) {
    let attempts = 0;
    await withMutedLogs(async () => {
      await assert.rejects(
        () => module.__testWithLlmRetry(testCase.name, () => module.__testCallOpenRouter('prompt', {
          apiKey: 'test',
          fetchImpl: async () => {
            attempts += 1;
            return response(testCase.body);
          }
        }), { sleepFn: async () => {} }),
        testCase.expected
      );
    });
    assert.equal(attempts, 3);
  }
});

test('transient HTTP 200 error envelopes retry and then succeed', async () => {
  const module = await importWriterModule('post_market');
  let attempts = 0;
  const result = await withMutedLogs(async () => module.__testWithLlmRetry(
    'error-envelope',
    () => module.__testCallOpenRouter('prompt', {
      apiKey: 'test',
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? response({ error: { code: 429, message: 'retry later secret payload' } })
          : response(completion('post_market', reports.post_market));
      }
    }),
    { sleepFn: async () => {} }
  ));
  assert.deepEqual(result, reports.post_market);
  assert.equal(attempts, 2);
});

test('malformed content retries and then accepts a valid response', async () => {
  const module = await importWriterModule('post_market');
  let attempts = 0;
  const result = await withMutedLogs(async () => module.__testWithLlmRetry(
    'malformed-then-success',
    () => module.__testCallOpenRouter('prompt', {
      apiKey: 'test',
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? response({ choices: [{ finish_reason: 'stop', message: { content: '{"marketSummary":' } }] })
          : response(completion('post_market', reports.post_market));
      }
    }),
    { sleepFn: async () => {} }
  ));
  assert.deepEqual(result, reports.post_market);
  assert.equal(attempts, 2);
});

test('401 authentication errors are terminal and do not retain provider payloads', async () => {
  const module = await importWriterModule('post_market');
  let attempts = 0;
  await withMutedLogs(async () => {
    await assert.rejects(
      () => module.__testWithLlmRetry('auth', () => module.__testCallOpenRouter('prompt', {
        apiKey: 'test',
        fetchImpl: async () => {
          attempts += 1;
          return response({ error: { code: 'invalid_api_key', message: 'private key body' } }, 401);
        }
      }), { sleepFn: async () => {} }),
      (error) => {
        assert.equal(error.message, 'openrouter_failed_invalid_api_key');
        assert.equal(error.status, 401);
        assert.equal(error.retryable, false);
        assert.equal(error.body, undefined);
        assert.doesNotMatch(error.message, /private|key body/);
        return true;
      }
    );
  });
  assert.equal(attempts, 1);

  let misleadingAttempts = 0;
  await withMutedLogs(async () => {
    await assert.rejects(
      () => module.__testWithLlmRetry('auth-misleading-body', () => module.__testCallOpenRouter('prompt', {
        apiKey: 'test',
        fetchImpl: async () => {
          misleadingAttempts += 1;
          return response({ error: { message: 'provider unavailable private payload' } }, 401);
        }
      }), { sleepFn: async () => {} }),
      (error) => error.message === 'openrouter_failed_401' && error.retryable === false
    );
  });
  assert.equal(misleadingAttempts, 1);
});

test('response body reads remain bounded by the writer timeout', async () => {
  const module = await importWriterModule('post_market');
  await assert.rejects(
    () => module.__testCallOpenRouter('prompt', {
      apiKey: 'test',
      timeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {})
    })
  }),
    /request_deadline_exceeded/
  );
});

test('null, primitive, and root-array reports fail as retryable shape errors before pre-market repair', async () => {
  const module = await importWriterModule('pre_market');
  const malformedRoots = ['null', '1', '[]'];
  for (const content of malformedRoots) {
    await assert.rejects(
      () => module.__testCallOpenRouter('prompt', {
        apiKey: 'test',
        marketResearch: {
          marketNews: [{ title: '근거', summary: '충분한 근거입니다.' }],
          majorIndices: [{ title: 'KOSPI', value: '2,700.00' }]
        },
        fetchImpl: async () => response({
          choices: [{ finish_reason: 'stop', message: { content } }]
        })
      }),
      /invalid_report_shape:root/
    );
  }
});

test('post-market weak sector is a required nullable string and pre-market schema remains unchanged', async () => {
  const postModule = await importWriterModule('post_market');
  const postSchema = postModule.__testReportJsonSchema();
  const weakSchema = postSchema.properties.sectorThemes.properties.weak;
  assert.deepEqual(weakSchema, { type: ['string', 'null'] });
  assert.ok(postSchema.properties.sectorThemes.required.includes('weak'));
  assert.match(postModule.__testBuildPrompt({}), /sectorThemes\.weak/);
  assert.match(postModule.__testBuildPrompt({}), /null/);

  const nullable = structuredClone(reports.post_market);
  nullable.sectorThemes.weak = null;
  assert.doesNotThrow(() => postModule.__testValidateReportShape(nullable));

  for (const invalid of ['', '   ', 1, [], {}]) {
    const report = structuredClone(reports.post_market);
    report.sectorThemes.weak = invalid;
    assert.throws(
      () => postModule.__testValidateReportShape(report),
      /sectorThemes\.weak/
    );
  }

  const missing = structuredClone(reports.post_market);
  delete missing.sectorThemes.weak;
  assert.throws(
    () => postModule.__testValidateReportShape(missing),
    /sectorThemes\.weak/
  );

  const nullStrong = structuredClone(reports.post_market);
  nullStrong.sectorThemes.strong = null;
  assert.throws(
    () => postModule.__testValidateReportShape(nullStrong),
    /sectorThemes\.strong/
  );

  const preModule = await importWriterModule('pre_market');
  assert.deepEqual(preModule.__testReportJsonSchema().properties.sectorWeather.properties.rainy, { type: 'string' });
  assert.doesNotMatch(preModule.__testBuildPrompt({}), /sectorWeather\.rainy.*null/);
});

test('OpenRouter null weak response passes writer validation, prepare, and render without weakening other sections', async () => {
  const module = await importWriterModule('post_market');
  const responseReport = structuredClone(reports.post_market);
  responseReport.sectorThemes.weak = null;
  const marketResearch = {
    marketEventSignals: [],
    marketEventConclusions: [],
    investorFlows: { status: 'unavailable', markets: [] }
  };
  const parsed = await module.__testCallOpenRouter('prompt', {
    apiKey: 'test',
    marketResearch,
    fetchImpl: async () => response(completion('post_market', responseReport))
  });
  const validated = module.__testPrepareAndValidateWriterReport(marketResearch, parsed);
  const prepared = module.__testPrepareReportForPublish(marketResearch, validated);
  const html = module.__testRenderPostMarketReport(prepared);

  assert.equal(prepared.investorFlows, null);
  assert.equal(prepared.sectorThemes.strong, responseReport.sectorThemes.strong);
  assert.equal(prepared.sectorThemes.weak, null);
  assert.deepEqual(prepared.marketSummary, responseReport.marketSummary);
  assert.deepEqual(prepared.notableStocks, responseReport.notableStocks);
  assert.deepEqual(prepared.tomorrowStrategy, responseReport.tomorrowStrategy);
  assert.match(html, /✅ 강세 업종/);
  assert.doesNotMatch(html, /❌ 약세 업종|>null<|>undefined</);
});

test('mixed-only high sector evidence preserves null weak through repeated prepare and omits its row', async () => {
  const module = await importWriterModule('post_market');
  const report = structuredClone(reports.post_market);
  report.sectorThemes.strong = '바이오가 강세였습니다.';
  report.sectorThemes.weak = null;
  const mixedSignal = {
    direction: 'mixed',
    severity: 'high',
    primaryTarget: { key: 'semiconductor', label: '반도체', scope: 'sector' },
    targets: [{ key: 'semiconductor', label: '반도체', scope: 'sector' }],
    headline: '반도체 업종 수요 개선과 비용 부담 혼조',
    directionEvidence: null
  };
  const marketResearch = {
    marketEventSignals: [mixedSignal],
    marketEventConclusions: [mixedSignal],
    investorFlows: { status: 'unavailable', markets: [] }
  };

  const once = module.__testPrepareReportForPublish(marketResearch, report);
  const twice = module.__testPrepareReportForPublish(marketResearch, once);
  assert.match(once.marketSummary.summary, /혼조/);
  assert.match(once.marketSummary.summary, /반도체 업종 수요 개선과 비용 부담 혼조/);
  assert.equal(once.sectorThemes.strong, report.sectorThemes.strong);
  assert.equal(once.sectorThemes.weak, null);
  assert.equal(twice.sectorThemes.weak, null);
  assert.deepEqual(twice, once);

  const html = module.__testRenderPostMarketReport(twice);
  assert.match(html, /✅ 강세 업종/);
  assert.doesNotMatch(html, /❌ 약세 업종|>null<|>undefined</);
});

test('mixed evidence appends once to nonnull weak copy across repeated prepare', async () => {
  const module = await importWriterModule('post_market');
  const report = structuredClone(reports.post_market);
  report.sectorThemes.strong = '바이오가 강세였습니다.';
  report.sectorThemes.weak = '자동차가 약세였습니다.';
  const mixedSignal = {
    direction: 'mixed',
    severity: 'high',
    primaryTarget: { key: 'semiconductor', label: '반도체', scope: 'sector' },
    targets: [{ key: 'semiconductor', label: '반도체', scope: 'sector' }],
    headline: '반도체 업종 수요 개선과 비용 부담 혼조',
    directionEvidence: null
  };
  const marketResearch = {
    marketEventSignals: [mixedSignal],
    marketEventConclusions: [mixedSignal],
    investorFlows: { status: 'unavailable', markets: [] }
  };

  const once = module.__testPrepareReportForPublish(marketResearch, report);
  const twice = module.__testPrepareReportForPublish(marketResearch, once);
  assert.match(once.sectorThemes.weak, /^자동차가 약세였습니다\. \/ 혼조: 반도체 - /);
  assert.equal(twice.sectorThemes.weak, once.sectorThemes.weak);
  assert.equal(twice.sectorThemes.strong, report.sectorThemes.strong);
});

test('real negative evidence populates grounded weak copy from null', async () => {
  const module = await importWriterModule('post_market');
  const report = structuredClone(reports.post_market);
  report.sectorThemes.weak = null;
  const negativeSignal = {
    direction: 'negative',
    severity: 'high',
    primaryTarget: { key: 'semiconductor', label: '반도체', scope: 'sector' },
    targets: [{ key: 'semiconductor', label: '반도체', scope: 'sector' }],
    headline: '반도체 업종 수요 둔화와 가격 약세',
    directionEvidence: null
  };
  const prepared = module.__testPrepareReportForPublish({
    marketEventSignals: [negativeSignal],
    marketEventConclusions: [negativeSignal],
    investorFlows: { status: 'unavailable', markets: [] }
  }, report);

  assert.match(prepared.sectorThemes.weak, /^반도체 - /);
  assert.match(prepared.sectorThemes.weak, /반도체 업종 수요 둔화와 가격 약세/);
});

test('positive contradiction removes unsupported nonnull weak copy without changing strong behavior', async () => {
  const module = await importWriterModule('post_market');
  const report = structuredClone(reports.post_market);
  report.sectorThemes.strong = '바이오가 강세였습니다.';
  report.sectorThemes.weak = '반도체가 약세였습니다.';
  const positiveSignal = {
    direction: 'positive',
    severity: 'high',
    primaryTarget: { key: 'semiconductor', label: '반도체', scope: 'sector' },
    targets: [{ key: 'semiconductor', label: '반도체', scope: 'sector' }],
    headline: '반도체 업종 수요 회복과 가격 상승',
    directionEvidence: null
  };
  const prepared = module.__testPrepareReportForPublish({
    marketEventSignals: [positiveSignal],
    marketEventConclusions: [positiveSignal],
    investorFlows: { status: 'unavailable', markets: [] }
  }, report);

  assert.equal(prepared.sectorThemes.weak, null);
  assert.match(prepared.sectorThemes.strong, /^반도체 - /);
});

test('post-market weak sector keeps supported strings and placeholder rejection remains fail-closed', async () => {
  const module = await importWriterModule('post_market');
  const grounded = structuredClone(reports.post_market);
  assert.equal(
    module.__testPrepareAndValidateWriterReport({
      marketEventSignals: [],
      marketEventConclusions: [],
      investorFlows: { status: 'unavailable', markets: [] }
    }, grounded).sectorThemes.weak,
    grounded.sectorThemes.weak
  );

  const placeholder = structuredClone(reports.post_market);
  placeholder.sectorThemes.weak = '약세 업종 확인 필요';
  let failure;
  try {
    module.__testPrepareAndValidateWriterReport({
      marketEventSignals: [],
      marketEventConclusions: [],
      investorFlows: { status: 'unavailable', markets: [] }
    }, placeholder);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.match(failure.message, /briefing_writer_quality_failed:placeholder_copy/);
  const retry = module.__testBuildWriterRetryPrompt('evidence', failure);
  assert.match(retry, /sectorThemes\.weak/);
  assert.match(retry, /근거가 없을 때만 명시적으로 null/);
  assert.match(retry, /임의의 거부 문구를 null로 바꾸지 않는다/);
  assert.doesNotMatch(retry, /약세 업종 확인 필요/);
});

test('writer quality rejection remains fail-closed for placeholder copy', async () => {
  const module = await importWriterModule('post_market');
  assert.throws(
    () => module.__testPrepareAndValidateWriterReport({
      marketNews: [],
      investorFlows: { status: 'unavailable', markets: [] }
    }, {
      ...reports.post_market,
      marketSummary: { ...reports.post_market.marketSummary, kospi: '0,000.00 (확인 필요)' }
    }),
    /briefing_writer_quality_failed:placeholder_copy/
  );
});


test('post-market schema minimums match local validation without weakening evidence checks', async () => {
  const module = await importWriterModule('post_market');
  const schema = module.__testReportJsonSchema();
  const example = module.__testReportSchema();
  for (const key of ['surging', 'plunging']) {
    assert.equal(schema.properties.notableStocks.properties[key].minItems, 2);
    assert.equal(example.notableStocks[key].length, 2);
    for (const invalid of [undefined, null, 'single stock', [], ['one'], ['one', ''], ['one', 2]]) {
      const report = structuredClone(reports.post_market);
      report.notableStocks[key] = invalid;
      assert.throws(() => module.__testValidateReportShape(report), new RegExp(`notableStocks\\.${key}`));
    }
  }
  assert.equal(schema.properties.tomorrowStrategy.properties.checklist.minItems, 3);
  const shortChecklist = structuredClone(reports.post_market);
  shortChecklist.tomorrowStrategy.checklist = ['one', 'two'];
  assert.throws(() => module.__testValidateReportShape(shortChecklist), /tomorrowStrategy.checklist/);
  assert.doesNotThrow(() => module.__testValidateReportShape(structuredClone(reports.post_market)));
});

test('quality feedback identifies placeholder fields without echoing rejected content', async () => {
  const module = await importWriterModule('post_market');
  const report = structuredClone(reports.post_market);
  report.tomorrowStrategy.checklist[1] = 'PRIVATE_CONTENT 확인 필요';
  report.notableStocks.plunging[0] = 'PRIVATE_CONTENT 확인 불가';
  let failure;
  try {
    module.__testPrepareAndValidateWriterReport({ investorFlows: { status: 'unavailable' } }, report);
  } catch (error) { failure = error; }
  assert.ok(failure);
  assert.equal(failure.code, 'briefing_writer_quality_failed');
  assert.deepEqual(failure.invalidFields, ['notableStocks.plunging.0', 'tomorrowStrategy.checklist.1']);
  const retry = module.__testBuildWriterRetryPrompt('evidence', failure);
  assert.match(retry, /notableStocks.plunging.0/);
  assert.match(retry, /tomorrowStrategy.checklist.1/);
  assert.doesNotMatch(retry, /PRIVATE_CONTENT/);
  assert.match(module.__testBuildPrompt({}), /모든 출력 필드/);
});
