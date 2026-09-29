# Інструкція впровадження: анонімне медіа, транскрипт і висновки сесії

## 1. Мета та межі першого релізу

Потрібно додати до GhostTalk три пов’язані можливості:

1. Передавати іншим учасникам лише модифікований або синтетичний голос, не оригінальний аудіотрек.
2. За бажанням учасника замінювати камеру аватаром, не публікуючи оригінальне відео.
3. Створювати текстовий протокол розмови з псевдонімами, таймкодами та автоматичним підсумком сесії.

Рекомендований MVP:

- режими `normal`, `masked` і `synthetic` для аудіо;
- клієнтський 2D/3D аватар замість камери;
- streaming-транскрипція в розрізі окремих LiveKit-треків;
- live captions, фінальні сегменти в PostgreSQL і фонове формування висновку;
- без запису оригінального аудіо й відео за замовчуванням.

Не включати в MVP реалістичну генерацію «говорячого портрета» або video-to-video: вона потребує GPU, збільшує затримку та значно ускладнює контроль приватності.

## 2. Цільова архітектура

```text
                    ┌─────────────────────┐
                    │ React / LiveKit SDK  │
                    └──────────┬──────────┘
                               │
                  private raw audio/video track
                               │
                               ▼
┌───────────────────────────────────────────────────────┐
│ LiveKit Agent (media-worker)                            │
│                                                        │
│ raw audio ─┬─→ VAD → STT → transcript segments → DB    │
│            │                         │                  │
│            │                         └─→ SSE captions   │
│            │                                            │
│            └─→ DSP/voice conversion або STT→TTS         │
│                                  │                      │
│                                  └─→ anonymized track   │
└───────────────────────────────────────────────────────┘
                               │
                               ▼
                       LiveKit room
                               │
                               ▼
                   Інші учасники зустрічі

PostgreSQL ← transcript_segments, session_insights, action_items
                ↑
                └─ background analysis worker / LLM
```

### Принципи безпеки

- Оригінальний трек може бути доступний лише учаснику та server-side worker’у.
- При активному анонімному режимі UI і backend не дозволяють публікувати raw track у загальну кімнату.
- Учасники отримують лише `anonymized` audio track та/або avatar video track.
- Для протоколу використовувати псевдонім конкретної сесії, а не ім’я, голос або обліковий запис людини.
- Не зберігати raw audio/video без окремої, явно увімкненої згоди.

## 3. Етап 0 — рішення перед розробкою

### 3.1. Визначити режими медіа

| Режим | Що отримують інші | Затримка | Рівень анонімності |
|---|---|---:|---|
| `normal` | Оригінальні аудіо й відео | низька | Немає |
| `masked` | Оброблений аудіотрек, аватар за вибором | ~150–400 мс | Середній |
| `synthetic` | STT → фільтр → TTS, аватар за вибором | ~0.8–2.5 с | Високий |

`masked` не можна позиціювати як абсолютну анонімність: проста зміна pitch не захищає від розпізнавання за голосом. Для чутливих зустрічей слід пропонувати `synthetic`.

### 3.2. Політика приватності

До початку розробки узгодити й зафіксувати:

- текст згоди на транскрипцію та анонімізацію;
- ролі, що можуть переглядати протокол і висновки;
- строк зберігання транскриптів;
- чи можна експортувати протокол;
- перелік даних, які редагуються до збереження (PII, телефони, email тощо);
- заборону запису raw media за замовчуванням.

## 4. Етап 1 — зміни моделі даних і API

### 4.1. Додати міграцію

Створити `db/migrations/002_transcripts_and_insights.sql`.

```sql
CREATE TABLE transcript_segments (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_alias VARCHAR(80) NOT NULL,
    track_sid VARCHAR(128) NOT NULL DEFAULT '',
    started_at_ms BIGINT NOT NULL,
    ended_at_ms BIGINT NOT NULL,
    text TEXT NOT NULL,
    language VARCHAR(20) NOT NULL DEFAULT '',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_final BOOLEAN NOT NULL DEFAULT TRUE,
    redacted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transcript_segments_session_time
    ON transcript_segments(session_id, started_at_ms, id);

CREATE TABLE session_analysis_jobs (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    requested_by_role VARCHAR(40) NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE TABLE session_insights (
    session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    executive_summary TEXT NOT NULL DEFAULT '',
    themes JSONB NOT NULL DEFAULT '[]'::jsonb,
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE action_items (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    owner_alias VARCHAR(80) NOT NULL DEFAULT '',
    due_date DATE,
    source_segment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2. Розширити Go-моделі й store

У `backend/internal/model/` додати моделі `TranscriptSegment`, `SessionInsight`, `ActionItem`, `AnalysisJob`. У `backend/internal/store/` реалізувати:

- `CreateTranscriptSegment`;
- `ListTranscriptSegments(sessionID, fromMs, limit)`;
- `UpdateTranscriptSegment` для переходу від проміжного до фінального результату;
- `CreateAnalysisJob`, `ClaimNextAnalysisJob`, `CompleteAnalysisJob`, `FailAnalysisJob`;
- CRUD для `session_insights` і `action_items`.

Всі запити на читання протоколу мають перевіряти права фасилітатора. Учасник може бачити live captions лише якщо це дозволено налаштуваннями сесії.

### 4.3. Додати API

| Метод | Шлях | Призначення |
|---|---|---|
| `GET` | `/api/sessions/:code/transcript` | Фінальний протокол, посторінково |
| `POST` | `/api/sessions/:code/transcript/export` | Експорт Markdown або JSON |
| `POST` | `/api/sessions/:code/analysis-jobs` | Запустити побудову висновку |
| `GET` | `/api/sessions/:code/insights` | Висновки й action items |
| `PATCH` | `/api/action-items/:id` | Виправити задачу/відповідального/дедлайн |
| `POST` | `/api/internal/transcript-segments` | Внутрішній endpoint тільки для worker-а |

Внутрішні endpoint-и не повинні бути доступні через публічний Nginx-маршрут. Додати service-to-service автентифікацію: окремий секрет у заголовку або mTLS.

### 4.4. Події SSE

Надсилати через наявний `realtime.Hub`:

- `transcript.segment.partial` — тимчасовий текст, не зберігається або зберігається короткочасно;
- `transcript.segment.final` — фінальний текст, збережений у БД;
- `analysis.started`, `analysis.completed`, `analysis.failed`;
- `anonymous_audio.ready`, `anonymous_audio.error` — зберегти сумісність із чинним UI.

## 5. Етап 2 — LiveKit media worker

### 5.1. Замінити поточний status worker

`anonymous-audio-worker` треба перетворити на справжній LiveKit Agent або додати новий сервіс `media-worker/`. Перевага окремого сервісу: чинний status worker можна залишити до повної міграції.

Worker повинен:

1. Приймати завдання для конкретної кімнати та учасника.
2. Підписуватися на його приватний raw audio track.
3. Визначати фази мовлення через VAD.
4. Відправляти аудіосегменти у streaming STT.
5. Публікувати фінальні/проміжні сегменти у backend.
6. Залежно від `audio_mode` створювати й публікувати processed track.
7. Коректно очищати буфери в RAM після завершення фрази.

### 5.2. Керування правами LiveKit

Змінити логіку `/api/sessions/:code/video-token`:

- `normal`: учасник може публікувати звичайні tracks;
- `masked` і `synthetic`: учасник публікує raw tracks у приватний ingress/worker-контур або підключається до окремої input-room;
- іншим учасникам видається доступ на підписку лише до processed tracks;
- worker отримує admin/agent permissions тільки для потрібної кімнати.

Найпростіша безпечна реалізація — дві кімнати:

```text
input room: учасник + worker, raw tracks
public room: усі учасники, лише processed tracks
```

Альтернатива з однією кімнатою допустима лише якщо впевнено реалізовано track permissions і raw tracks не стають доступними іншим учасникам.

### 5.3. Спостережуваність

Додати метрики:

- `media_worker_active_participants`;
- затримка STT та TTS;
- кількість сегментів і помилок;
- частка fallback у `mute`;
- CPU/GPU, довжина черг та reconnect-и до LiveKit.

Не логувати транскрипт або raw audio у звичайні application logs.

## 6. Етап 3 — анонімізація голосу

### 6.1. Режим masked

Пайплайн:

```text
audio frame → VAD → denoise → loudness normalization
            → formant/pitch/voice conversion → processed audio track
```

Почати з передбачуваної DSP-обробки; вона має бути realtime-friendly. Обов’язкові тести на українському й англійському мовленні. Не використовувати лише pitch shift як гарантію анонімності.

### 6.2. Режим synthetic

Пайплайн:

```text
VAD → streaming STT → PII-redaction → streaming TTS → processed audio track
```

Для MVP використати Faster Whisper для STT і Piper для TTS, але оцінити затримку на реальному GPU. Якщо вона неприйнятна, інтегрувати зовнішній streaming provider після окремого privacy review.

### 6.3. Fallback

Якщо worker не готовий або затримка перевищує заданий поріг:

- за замовчуванням застосувати `mute`, а не raw audio;
- показати учаснику чіткий індикатор помилки;
- записати технічну подію в аудит без тексту або аудіо;
- не перемикати тихо на звичайний голос.

## 7. Етап 4 — аватар замість відео

### 7.1. MVP у браузері

1. Додати до `VideoRoomPage` вибір: камера, статичний аватар, анімований аватар.
2. Для анімованого аватара отримувати head pose та face landmarks через MediaPipe Face Landmarker.
3. Рендерити 2D/3D аватар на `canvas` через Three.js або аналог.
4. Створити трек через `canvas.captureStream()`.
5. Публікувати canvas video track у LiveKit замість camera track.
6. Не створювати й не публікувати трек камери при виборі аватара.

### 7.2. Синхронізація з мовленням

- У режимі `synthetic` керувати рухом губ за фонемами TTS або амплітудою фінального синтетичного аудіо.
- У режимі `masked` достатньо візем за амплітудою обробленого треку для MVP.
- Не передавати face landmarks на сервер, якщо це не є необхідним для рендерингу.

## 8. Етап 5 — streaming-транскрипція

### 8.1. Прив’язка автора

Кожен LiveKit audio track уже має publisher identity. Worker зв’язує її з `participant_id`, але зберігає і показує лише `participant_alias`, наприклад «Учасник 3».

Це кращий підхід, ніж speaker diarization за голосом: він точніший і не створює додаткового біометричного профілю.

### 8.2. Потік даних

1. VAD визначає початок фрази.
2. Worker передає короткі аудіочанки STT-провайдеру.
3. Проміжний текст надсилається як SSE `partial`.
4. Після паузи або фіналізації STT worker застосовує PII-redaction.
5. Worker надсилає фінальний сегмент до внутрішнього backend endpoint.
6. Backend записує сегмент у БД та надсилає `final` через SSE.

Час у сегментах зберігати як мілісекунди від старту сесії — це спрощує таймлайн, цитування та відтворення без зберігання відео.

### 8.3. UI

Додати:

- компактний блок live captions у відеокімнаті;
- вкладку «Протокол» для фасилітатора;
- фільтри за учасником, часом, мовою;
- кнопку експорту Markdown/JSON;
- позначення низької впевненості транскрипції;
- можливість фасилітатору виправити текст з аудитом редагувань.

## 9. Етап 6 — висновки та action items

### 9.1. Черга фонових задач

Не викликати LLM безпосередньо з HTTP handler-а. Після завершення сесії або за дією фасилітатора створювати рядок у `session_analysis_jobs`.

Окремий `analysis-worker`:

1. Забирає задачу атомарно.
2. Читає фінальні transcript segments, картки, голоси й методологію.
3. Формує структурований prompt і передає лише мінімально потрібні дані.
4. Валідує JSON-відповідь за схемою.
5. Записує `session_insights` і `action_items`.
6. Публікує SSE-подію про результат.

### 9.2. Формат результату

Вимагати структурований JSON, а не лише Markdown:

```json
{
  "executive_summary": "...",
  "themes": [{"title": "...", "summary": "...", "segment_ids": [12, 19]}],
  "decisions": [{"text": "...", "segment_ids": [21]}],
  "risks_questions": [{"text": "...", "segment_ids": [25]}],
  "action_items": [{"text": "...", "owner_alias": "Учасник 2", "due_date": null, "segment_ids": [30]}]
}
```

Після цього frontend може окремо відображати висновки, задачі та їхні першоджерела, а Markdown генерувати вже з перевірених структурованих даних.

## 10. Інфраструктура та конфігурація

Додати у Docker Compose окремі сервіси `media-worker` і `analysis-worker`. Для production підготувати GPU-профіль для STT/TTS/voice conversion: CPU-режим годиться лише для малого навантаження або для асинхронної обробки.

Приклад змінних середовища:

```text
LIVEKIT_URL=wss://meet.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
INTERNAL_WORKER_TOKEN=...
STT_PROVIDER=faster-whisper
STT_MODEL=small
TTS_PROVIDER=piper
TRANSCRIPT_RETENTION_DAYS=30
RAW_MEDIA_RETENTION=false
ANALYSIS_PROVIDER=...
ANALYSIS_MODEL=...
```

Секрети не зберігати в Git і не віддавати у frontend build arguments.

## 11. Тестування та критерії готовності

### Функціональні тести

- У `masked` та `synthetic` режимах інший учасник ніколи не підписується на raw audio track.
- Відмова worker-а веде до mute, а не до передачі оригінального голосу.
- Для кожного фінального сегмента зберігається псевдонім, текст і коректний таймкод.
- Дублів transcript segment не виникає після reconnect worker-а.
- Підсумок містить посилання на `segment_ids`; action items можна редагувати вручну.
- При виході учасника буфери й приватні tracks очищуються.

### Нефункціональні критерії MVP

- `masked`: медіазатримка p95 не більше 500 мс у цільовому середовищі.
- `synthetic`: затримка першої фрази вимірюється й відображається; ціль — до 2.5 с.
- Проміжні captions з’являються до 1.5 с після початку фрази за нормального навантаження.
- У логах і трасуваннях немає raw media, токенів доступу або тексту транскриптів.
- Навантажувальний тест проходить для цільової кількості одночасних кімнат.

## 12. Рекомендована послідовність робіт

1. Погодити privacy policy, режими та retention.
2. Додати міграцію, Go-моделі, store та read-only API протоколу.
3. Додати LiveKit Agent, який лише збирає streaming transcripts.
4. Вивести live captions і протокол у UI.
5. Додати фоновий worker висновків та action items.
6. Реалізувати `synthetic` voice з безпечним fallback у mute.
7. Додати `masked` voice після benchmark-ів якості й затримки (реалізовано; локальний harness — `tools/benchmark_media.py`).
8. Додати canvas-аватар у frontend.
9. Провести security review LiveKit permissions, API, журналювання та retention.
10. Провести пілот із кількома реальними сесіями, зібрати метрики та скоригувати пороги затримок.

Такий порядок спочатку створює найбільш корисну й контрольовану частину — текстовий протокол та висновки — а потім поступово додає складну real-time анонімізацію медіа.

## 13. Поточний статус впровадження

У репозиторії реалізовано міграції, consent, PII-redaction перед записом, idempotency сегментів, facilitator-only transcript/insights API, експорт, редагування з аудитом, analysis worker, private SSE-події та UI протоколу. Для production-safe voice pipeline реалізовано dual-room `media-worker`: raw microphone публікується лише в `input room`, STT проходить через internal backend route, redacted text синтезується TTS і processed track публікується в `public room`. Додатково доступний low-latency `masked` режим із потоковим timbre-трансформом; він не позиціонується як biometric-grade анонімність. Browser synthetic mode fail-closed: за увімкненого анонімного режиму public token не має права публікувати microphone.

Для dual topology permission policy автоматично перевіряється unit-тестами на підписаних LiveKit JWT: `anonymous`/`masked` public token дозволяє лише camera, `normal` додає microphone, а input token дозволяє лише microphone без subscribe. При перемиканні режиму під час дзвінка frontend оновлює public JWT до перенесення track між кімнатами; тому старий дозвіл на raw microphone не залишається активним. `masked` не вимагає legacy `anonymous-audio-worker` для ввімкнення.

PCM16-трансформація `masked` винесена в чисту функцію з окремими standard-library тестами: перевіряються зміна ненульового сигналу та збереження довжини frame.

Для production privacy boundary додано `tools/security_check.py`: він перевіряє, що Nginx не проксіює `/api/internal/*`, CSP бере явний список origin-ів, а production Compose передає CSP-конфігурацію у frontend.

`media-worker` тепер одразу unpublish-ить processed track після revoke consent, завершення сесії або переходу в `normal`; stale audio track не залишається в public room.

Для read-only API smoke перед пілотом додано `tools/load_test.py` з конкурентними запитами, p50/p95, throughput та error-rate без створення сесій або запису в БД.

Перед production-деплоєм `tools/production_preflight.py` блокує placeholder-секрети, `single` topology, небезпечний LiveKit URL та wildcard CSP/CORS.

Перед production залишаються зовнішні, неавтоматизовні передумови:

- затвердження consent/retention/export policy та ролей доступу;
- перевірка dual-room permission policy у цільовій LiveKit-інсталяції та rotation production API secrets;
- GPU/CPU benchmark VAD/STT/TTS/masked та підтвердження p95 latency у цільовому середовищі (harness уже доданий, production-вимірювання ще потрібне);
- інтеграційний security review LiveKit, Nginx internal routes, журналювання й retention;
- пілотні сесії та навантажувальне тестування в цільовому середовищі.
