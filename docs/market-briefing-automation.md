# 증시 브리핑 자동 발행 시스템 개발/운영 문서

이 문서는 `thirdtype-dev/report` 레포의 증시 브리핑 자동 발행 시스템 개발 내용과 운영 주의사항을 정리한다.

## 현재 운영 목표

- GitHub Actions는 브리핑/실시간급등 생성 실행 엔진이고, 실제 스케줄 트리거는 외부 Cloud Scheduler가 담당한다.
- 생성된 HTML은 GitHub Pages의 루트 `index.html`과 `/report/index.html`에 발행한다.
- 로컬 PC가 꺼져 있어도 발행은 GitHub Actions runner에서 수행된다.
- 브리핑 페이지는 상단 `리딩방` 제목과 `브리핑 / 실시간급등` 버튼형 탭 구조를 유지한다.
- `실시간급등` 버튼은 `realtime.html`과 `report/realtime.html` 별도 페이지로 이동한다.
- 별도 페이지는 브리핑 상단 chrome을 유지하고, 실시간급등 데이터 카드 목록을 직접 표시한다.
- 브리핑/실시간급등 HTML은 웹 브라우저 직접 진입 시 리딩방 비밀번호를 확인한다.
- 앱 WebView 진입은 `source=maedo-signal` 또는 Android WebView UA로 식별해 비밀번호 확인을 건너뛴다.
- Android 앱은 다음 업데이트부터 `https://thirdtype-dev.github.io/report/?source=maedo-signal`로 리딩방을 열어 웹 직접 진입과 앱 진입을 명확히 분리한다.

## 주요 파일

- `.github/workflows/publish-market-briefing.yml`
  - 외부 scheduler가 `workflow_dispatch`로 호출하는 브리핑 발행 워크플로.
  - Node 22, Python 3.12, `pykrx==1.2.8` 설치 후 생성기를 실행한다.
- `.github/workflows/publish-realtime-surge.yml`
  - 외부 scheduler가 `workflow_dispatch`로 호출하는 실시간급등 슬롯 발행 워크플로.
  - `slot_hour` 입력을 받아 `slot-adapter.json`과 `realtime-surge.json`을 갱신한다.
- `scripts/generate-market-briefing.mjs`
  - 데이터 수집, LLM 호출, HTML 생성의 핵심 스크립트.
- `scripts/fetch_investor_flows.py`
  - `pykrx/KRX` 기반 투자자별 수급 수집 헬퍼.
- `scripts/krx-business-day.mjs`
  - KST 기준 KRX 거래일 여부를 판정하는 휴장일 게이트.
- `index.html`
  - GitHub Pages 루트 발행본.
- `report/index.html`
  - `/report/` 경로 발행본.
- `realtime.html`
  - 루트 separate-page 실시간급등 shell.
- `report/realtime.html`
  - `/report/` 경로 separate-page 실시간급등 shell.
- `apps/maedo-signal-android/app/src/main/java/com/maedo/signal/MainActivity.kt`
  - Android 앱 리딩방 WebView 진입점. 앱은 `?source=maedo-signal` 마커로 웹 비밀번호 게이트를 우회한다.
- `report/data/market-research.json`
  - 수집된 정규화 데이터.
- `report/data/report.json`
  - LLM이 생성한 브리핑 JSON과 writer 정보.

## 발행 스케줄

실제 운영 스케줄은 GitHub Actions 내부 `schedule`이 아니라 외부 Cloud Scheduler 기준이다.

| 구분 | KST | UTC cron | 역할 |
| --- | --- | --- | --- |
| 장시작 | 08:30 | `30 23 * * 0-4` | 1차 발행 |
| 장시작 | 08:35 | `35 23 * * 0-4` | 백업 |
| 장시작 | 08:40 | `40 23 * * 0-4` | 백업 |
| 장마감 | 16:00 | `0 7 * * 1-5` | 1차 발행 |
| 장마감 | 16:05 | `5 7 * * 1-5` | 백업 |
| 장마감 | 16:10 | `10 7 * * 1-5` | 백업 |
| 실시간급등 | 09:00~15:00 30분 간격 | 별도 30분 cadence | 장중 슬롯 갱신 |

Cloud Scheduler는 Cloud Run relay를 호출하고, relay가 GitHub `workflow_dispatch`를 보낸다.

- 브리핑 수동 실행 시 `workflow_dispatch.inputs.phase`로 `pre_market` 또는 `post_market` 지정
- 실시간급등 수동 실행 시 `workflow_dispatch.inputs.slot_hour`로 `9`, `930`, `10`, `1030` ... `1430`, `15` 지정

휴장일 게이트:

- 워크플로는 생성 전에 `scripts/krx-business-day.mjs`를 실행한다.
- 거래일이 아니면 생성/배포/커밋 단계를 모두 건너뛴다.
- 수동 실행도 같은 기준으로 스킵된다.

주의: GitHub Actions scheduled workflow는 정시 보장형 스케줄러가 아니므로 운영 스케줄은 GitHub 밖으로 뺐다. GitHub Actions는 dispatch-only로 유지한다.

## 휴장일 기준

현재 자동발행의 휴장일 판정은 앱 쪽 기준을 따른다.

- 주말
- 2026년 KRX 휴장일 목록
- `2026-05-01` 노동절
- `2026-12-31` 연말 휴장
- 해당 연도 `12/31`이 토요일이면 `12/30`, 일요일이면 `12/29`도 연말 휴장
- 운영자가 `KRX_HOLIDAYS=YYYY-MM-DD,YYYYMMDD` 형식으로 수동 휴장일 추가 가능

주의:

- 연도별 휴장일 목록은 현재 `2026`만 코드에 반영돼 있다.
- 새해 운영 전에는 `scripts/krx-business-day.mjs`의 `HOLIDAYS_BY_YEAR`를 갱신해야 한다.

## LLM provider

현재 writer 설정:

- Primary: `openrouter/deepseek/deepseek-v4-flash`
- Fallback: `gemini/gemini-3.1-flash-lite`

필요 secrets:

- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `KRX_ID`
- `KRX_PW`

`KRX_ID`, `KRX_PW`는 `pykrx`가 KRX 로그인 세션을 요구하는 경우를 대비해 workflow env로 전달한다. 수급 수집이 실패해도 전체 발행은 실패시키지 않고 `unavailable` 또는 뉴스 기반 보조 근거로 진행한다.

## 데이터 수집 구조

### 지수/환율

`Yahoo Finance chart API`를 사용한다.

대상:

- `^KS11` KOSPI
- `^KQ11` KOSDAQ
- `KRW=X` USD/KRW
- `^IXIC` NASDAQ
- `^GSPC` S&P 500
- `NQ=F` Nasdaq Futures

주의:

- Yahoo Finance 값은 지연 시세일 수 있다.
- 국내 지수 값이 비정상적으로 반환되는 경우가 있을 수 있으므로, 페이지 품질 점검 시 우선 확인한다.

### 투자자별 수급

1차:

- `scripts/fetch_investor_flows.py`
- `pykrx`의 `stock.get_market_trading_value_by_date`
- KOSPI/KOSDAQ 최근 14일 안에서 실제 데이터가 있는 최신 거래일을 찾는다.
- 외국인, 기관, 개인, 금융투자, 투신, 연기금 등 세부 수급을 JSON으로 반환한다.

2차:

- `investorFlowNewsCandidates`
- Google News RSS 기반 수급 뉴스 후보.
- 정형 KRX 수급이 실패하면 LLM이 보도 기반으로 외국인/기관 흐름을 작성한다.

주의:

- 최근 14일 안에 수급 데이터가 없으면 오래된 데이터를 끌어오지 않는다.
- 뉴스 기반 수급일 때는 정확한 순매수 금액을 만들지 않는다.
- 프롬프트에서 `뉴스 기준`, `보도 기준` 같은 메타 표현은 금지하고 확인된 흐름만 자연스럽게 서술하도록 제한한다.
- 장마감 투자자별 수급은 당일 정형 수급만 사용한다. 정형 수급이 unavailable이면 전일/과거 뉴스 후보를 현재 장마감 수급처럼 대체하지 않는다.

### 기업 공시

현재는 OpenDART/KIND 정형 API를 붙이지 않았다.

대신:

- `disclosureNewsCandidates`
- Google News RSS 공시 전용 후보를 수집한다.
- 실적, 유상증자, 무상증자, 공급계약, 자사주, 배당, M&A, 정정 공시 관련 뉴스를 우선한다.

주의:

- 공시 원문 확정 데이터가 아니라 뉴스 기반 후보이다.
- LLM은 후보에 없는 기업명/공시 내용을 만들면 안 된다.

### 주요 일정

현재는 정형 일정 API를 붙이지 않았다.

대신:

- `scheduleNewsCandidates`
- Google News RSS 일정 후보를 수집한다.
- 신규상장, 청약, 보호예수 해제, 주주총회, 경제지표, 거래정지/변경상장 관련 뉴스를 우선한다.

주의:

- 날짜가 기사 제목/요약에 명시되지 않으면 LLM이 임의 날짜를 만들면 안 된다.
- 일정 후보가 오래된 기사일 수 있으므로, 발행 품질 점검 시 기사 날짜를 확인한다.

### 업종별/테마별 흐름

현재는 업종 지수 정형 API를 붙이지 않았다.

대신:

- `sectorThemeNewsCandidates`
- Google News RSS 업종/테마 후보를 수집한다.
- 반도체, 2차전지, 바이오, 자동차, 조선, 방산, 에너지 등 강세/약세 테마 뉴스를 근거로 작성한다.

주의:

- 정형 업종 등락률이 없으면 수치를 만들지 않는다.
- 강세/약세는 반드시 뉴스 근거가 있는 테마로 분리한다.

### 주요 특징주

장마감 필수 섹션이다.

수집:

- `stockNewsCandidates`
- Google News RSS 특징주 전용 후보를 수집한다.

쿼리 예:

- `오늘 특징주 급등 급락 코스피 코스닥`
- `증시 마감 특징주 상한가 하한가`
- `코스피 특징주 급등 상승 이유`
- `코스닥 특징주 급락 하락 이유`
- `오늘의 특징주 종목 상승 하락`
- `시간외 특징주 급등 급락`

LLM 규칙:

- 뉴스 제목/요약에 직접 언급된 종목만 사용한다.
- `surging`, `plunging` 각각 최소 2개 이상 작성한다.
- 등락률은 뉴스 제목/요약에 수치가 있을 때만 사용한다.
- 수치가 없으면 등락률 없이 상승/하락 배경만 작성한다.
- `확인 필요`, `없음`, `데이터 부족` 같은 회피 문구는 금지한다.

## 프롬프트 핵심 규칙

`scripts/generate-market-briefing.mjs`의 `buildPrompt()`에 포함된 주요 제약:

- 입력 JSON에 포함된 수치와 문장만 근거로 사용한다.
- 없는 수치나 사실을 추정하지 않는다.
- 투자 권유, 매수/매도 지시, 확정적 수익 표현을 금지한다.
- 장시작/장마감 섹션 구조와 라벨을 유지한다.
- JSON만 출력한다.
- 수급, 공시, 일정, 업종/테마, 특징주 섹션에서 `확인 필요`, `없음`, `데이터 부족`, `수집 실패` 같은 회피 문구를 금지한다.

## HTML/디자인 구조

현재 HTML 구조:

- `main.page`
- `section.room-header`
  - `h1.room-title`: `리딩방`
  - `button.room-tab`: `브리핑`
  - `button.room-tab`: `실시간급등`
- `section#briefing-pane`
  - 최신 브리핑 카드 최대 2건
- `section.disclaimer`
- `realtime.html`, `report/realtime.html`
  - 버튼형 상단 탭을 유지한 separate-page 실시간급등 shell

카드 색상:

- 장시작 카드: `report-pre-market`, 청록/블루 계열
- 장마감 카드: `report-post-market`, 오렌지/로즈 계열

주의:

- 페이지 템플릿은 생성기에서 만들어지므로, `index.html`만 직접 고치면 다음 자동 발행 때 덮어써진다.
- 브리핑 버튼이 separate-page 계약을 유지하려면 `scripts/generate-market-briefing.mjs`의 `renderHtml()`/`renderRoomScript()`와 정적 `realtime.html`/`report/realtime.html`을 함께 맞춰야 한다.
- 디자인 변경은 반드시 `scripts/generate-market-briefing.mjs`의 `REPORT_STYLE`, `renderHtml()`, 관련 렌더 함수에 반영한다.

## 수동 발행 방법

GitHub CLI:

```bash
gh workflow run "Publish Market Briefing" --repo thirdtype-dev/report -f phase=pre_market
gh workflow run "Publish Market Briefing" --repo thirdtype-dev/report -f phase=post_market
```

실행 확인:

```bash
gh run list --repo thirdtype-dev/report --workflow "Publish Market Briefing" --limit 5
gh run view <RUN_ID> --repo thirdtype-dev/report --json status,conclusion,jobs,url
```

공개 페이지 확인:

```bash
curl -fsSL -H 'Cache-Control: no-cache' 'https://thirdtype-dev.github.io/report/?v=<commit-or-cache-key>'
```

## 로컬 검증 방법

문법 검사:

```bash
node --check scripts/generate-market-briefing.mjs
python3 -m py_compile scripts/fetch_investor_flows.py
git diff --check
```

목업 발행:

```bash
REPORT_LLM_MOCK=1 BRIEFING_PHASE=pre_market PRESERVE_EXISTING_REPORTS=0 INVESTOR_FLOW_DISABLED=1 node scripts/generate-market-briefing.mjs
REPORT_LLM_MOCK=1 BRIEFING_PHASE=post_market PRESERVE_EXISTING_REPORTS=0 INVESTOR_FLOW_DISABLED=1 node scripts/generate-market-briefing.mjs
```

주의:

- 로컬 네트워크/DNS 제한 때문에 KRX나 Google News 호출이 실패할 수 있다.
- 실제 운영 기준 검증은 GitHub Actions run 결과와 원격 `report/data/*.json`으로 확인한다.

## 배포 동작

워크플로의 발행 단계:

1. `node scripts/generate-market-briefing.mjs`
2. `public/report/index.html` 생성
3. `public/report/data/market-research.json` 생성
4. `public/report/data/report.json` 생성
5. 생성된 HTML을 `index.html`, `report/index.html`로 복사
6. data JSON을 `report/data/`로 복사
7. 변경이 있으면 `github-actions[bot]`으로 커밋/푸시

주의:

- Actions가 발행 커밋을 추가하면 로컬 브랜치가 뒤처질 수 있다.
- 로컬에서 추가 변경을 푸시하기 전 `git pull --rebase origin main`을 먼저 수행한다.
- 다만 작업 중 unstaged 변경이 있으면 rebase가 막히므로 먼저 커밋하거나 변경을 정리한다.

## 알려진 한계와 주의사항

### GitHub Actions schedule

- GitHub Actions `schedule`은 정시 실행을 보장하지 않는다.
- 트리거가 지연되거나 누락될 수 있다.
- 이를 완화하기 위해 장시작/장마감 각각 3개 스케줄을 둔다.

### GitHub Pages 반영 지연

- Actions 커밋 후 Pages 공개 URL 반영까지 시간이 걸릴 수 있다.
- 확인 시 query string을 붙여 캐시를 피한다.

### Google News RSS

- RSS는 무료/무키로 사용 가능하지만, 검색 결과 품질이 고정적이지 않다.
- 오래된 기사나 중복 기사, 같은 매체 반복이 섞일 수 있다.
- LLM은 입력 후보 밖 사실을 만들면 안 된다.

### KRX/pykrx

- `pykrx`는 실용적이지만 KRX 페이지 구조/인증 정책 변경에 취약하다.
- `KRX_ID`, `KRX_PW`가 없거나 KRX가 응답하지 않으면 수급은 뉴스 후보 기반으로 보강한다.
- 최근 14일 안에 수급 데이터가 없으면 오래된 데이터를 사용하지 않는다.

### LLM 쿼터

- primary writer가 실패하거나 쿼터에 걸리면 Gemini 3.1 Flash Lite로 fallback한다.
- fallback도 실패하면 발행이 실패한다.
- 쿼터 이슈가 반복되면 발행 재시도 또는 provider/model 정책을 다시 봐야 한다.

### 투자 자문 리스크

- 모든 문구는 참고 정보여야 한다.
- 종목 추천, 매수/매도 지시, 확정 수익 표현은 금지한다.
- disclaimer는 유지한다.

## 향후 개선 후보

- OpenDART API Key를 발급해 기업 공시를 정형 데이터로 전환.
- KRX 업종지수/테마 정형 데이터를 추가해 업종별 강세/약세를 수치 기반으로 보강.
- 뉴스 후보 중복 제거와 최신성 필터 강화.
- 발행 후 공개 URL freshness를 자동 검증하고 실패 시 별도 알림/재시도.
- `실시간급등` 탭에 별도 파이프라인 연결.
