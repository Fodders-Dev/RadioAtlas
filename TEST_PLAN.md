# RadioAtlas Test Plan

## Scope

Primary target: Telegram Mini App WebView at 360-395px width. Desktop is a secondary control surface.

The current QA goal is to prove the core listening loop:

`open app -> start personal radio -> switch station -> search/globe/library still work -> player remains usable`.

## Preflight

- `npm run build`
- `npm test`
- Local smoke:
  - `npm run dev:api`
  - `npm run dev:webapp`
  - open `http://localhost:5173/?api=/api`

## Mobile Browser Smoke

Viewport: `390x844`, then repeat overflow checks at `360x780` and `412x844`.

1. Home first paint
   - Home opens without a blank state.
   - "Играть радио" CTA is visible.
   - At least one compact station rail is visible.
   - No visible recommendation reason copy like "по твоим лайкам" / "похоже на".
   - No horizontal page overflow.

2. Personal Radio
   - Tap "Играть радио".
   - Player dock shows the active station.
   - Next button switches station from the queue.
   - Like toggles without layout shift.
   - Mute toggles from the dock.

3. Search
   - Open bottom nav "Поиск".
   - Type a real query, e.g. `jazz japan`.
   - Results stay compact and playable.
   - Play from Search starts a queue, not a dead-end single station.

4. Globe
   - Open bottom nav "Глобус".
   - Canvas and bottom sheet are visible.
   - "Tune here" / regional play action works.
   - No mobile hint mentions desktop scroll wheel.

5. Library
   - Open bottom nav "Медиатека".
   - Tabs do not wrap on mobile.
   - Collections/Recent/Queue areas scroll.
   - Queue reflects the current player queue.

6. Station details / expanded player
   - Open station details from the player.
   - Trust, stream/site actions, report broken, hide/show recommendation controls are visible.
   - Expanded player opens and closes without breaking the dock.

7. API fallback
   - Simulate `/catalog/summary` failure.
   - Home still shows playable station choices via fallback, or shows the one-shot status banner only when both API and fallback fail.

## Desktop Smoke

Viewport: `1280x900`.

1. Home rails expose left/right arrow controls.
2. Mouse wheel or trackpad scrolls station rails horizontally.
3. Search filter drawer and results remain usable.
4. Expanded player opens from the dock.

## Regression Gate

- `npm --workspace apps/webapp run test:e2e -- mobile.spec.ts`
- `npm --workspace apps/webapp run test:e2e -- visual.spec.ts`
- `npm --workspace apps/api run test`
- `npm --workspace apps/bot run test`
- Full gate: `npm test`

## Ручная проверка на телефоне: Telegram → музыкальный сервис → Telegram

⚠ **Эту проверку нельзя заменить ничем автоматическим, и это не осторожность, а
факт про среду.** Playwright и десктоп дают вкладку браузера: другой движок,
другой жизненный цикл, другое поведение при сворачивании. Telegram на телефоне
может выгрузить WebView целиком, а не просто скрыть её. Всё, что 0.1b.1 делает,
происходит именно в момент возврата — значит проверять надо там, где возврат
настоящий.

Нужен: телефон с Telegram и установленным музыкальным сервисом (Яндекс Музыка
или Spotify), обычная мобильная сеть, **не Wi-Fi офиса** — важно, чтобы уход в
фон был настоящим и сеть могла подрезать сокет.

**Записывать экран с самого начала.** Если что-то сломается, ключевые 5 секунд —
это момент возврата, и переснять их «как было» не получится.

### Сценарий (≈6 минут)

1. Открыть RadioAtlas в Telegram. Включить любую станцию. Дождаться, чтобы
   **шёл звук** — не надписи «в эфире», а именно слышимый звук.
2. Открыть «Медиатеку» → «Находки». Нажать кнопку сервиса у любой находки.
3. Telegram уходит в музыкальный сервис. **Досчитать там до тридцати.** Можно
   включить трек — это как раз тот случай, ради которого запрет и написан.
4. Вернуться в Telegram (переключателем приложений, не по новой ссылке).
5. **Сразу засечь 30 секунд и НИЧЕГО не нажимать.** Запомни главное:
   играл ли звук в этот момент, и если пропадал — возвращался ли сам.

### Развилка на шаге 4: сначала ответь, был ли звук

⚠⚠ **Непрерывно играющий поток — это НЕ нарушение.** Если Telegram не тронул
приложение и радио всё время играло — так и задумано, это лучший исход.
Запрещено другое: **звук ПРЕКРАТИЛСЯ, а потом пошёл снова сам**, без нажатия.

Первая редакция этого чек-листа требовала «тишины после возврата» и объявила бы
правильное поведение блокером. Поэтому вернувшись, ответь ровно на один вопрос:

- **Звук не прерывался** → это ветка А. Пункт 1 не проверяется, иди к пункту 4.
- **Звук пропал** (в сервисе, в фоне или в момент возврата) → это ветка Б,
  главная. Проверяй с пункта 1.

Если не уверен — считай, что ветка Б, и скажи об этом в отчёте.

### Что должно быть

| # | Ветка | Проверка | Ожидание | Провал выглядит так |
| --- | --- | --- | --- | --- |
| 1 | Б | 30 секунд после возврата, руки убрать | Тихо, пока не нажмёшь | **Звук пошёл сам** — даже через 3 секунды, даже тихо |
| 2 | А и Б | Что на экране | Та же станция в плеере | Станция пропала; уехало на другую |
| 3 | Б | Play (см. про два нажатия ниже) | Звук возвращается, **та же станция** | Молчит; вечная «Буферизация»; другая станция |
| 4 | А и Б | Слушать 20 секунд | Звук идёт ровно | Секунду поиграло и встало |
| 5 | А и Б | Пауза, затем 30 секунд не трогать | Тихо | **Само возобновилось** |
| 6 | — | Повтор шагов 2–5, но отсутствовать **5 секунд** | То же самое | То же самое |

Шаг 6 не формальность: до 10 секунд приложение не берётся судить, жив ли поток,
и именно этот короткий случай раньше приводил к «нажал Play — тишина».

### ⚠ Известный долг: иногда Play — это два нажатия

Если поток умер, но система не перевела элемент в паузу, внизу будет плашка
**«БУФЕРИЗАЦИЯ» и кнопка Паузы** — при том, что звука нет. Чтобы добраться до
Play, придётся сначала нажать Паузу. Это **известно и уже записано как долг**,
в этой проверке блокером не считается.

Что важно: после такой Паузы следующий Play обязан **переподключить** станцию, а
не молча ничего не сделать. Если после Паузы Play не даёт звук — это пункт 3, и
это блокер. Отметь в отчёте, сколько нажатий понадобилось.

### Что прислать

- Запись экрана целиком.
- Первой строкой: **ветка А или Б** — прерывался ли звук.
- Одной строкой на каждый пункт: номер, «ок» или «не ок», и что было слышно.
- Если «не ок» — сколько секунд прошло до звука и что показывал плеер.
- Сколько нажатий понадобилось, чтобы вернуть звук.

### Что считать блокером выпуска

- Пункт 1 — **блокер**: звук прекращался и вернулся сам. Прямое нарушение.
- Пункт 3 — **блокер**: Play не возвращает звук. Ради этого полоса и написана.
- Пункт 5 — **блокер**: после Паузы пошло само.
- Пункт 2 (потеря или подмена станции) — **блокер**.
- Пункт 4 и «Play понадобилось два нажатия» — записать, не блокеры.

## Release Blockers

- Blank or single-card Home on 360-395px.
- Any horizontal overflow on Home/Search/Globe/Library mobile.
- Personal Radio cannot start in one tap.
- Broken station remains primary after failure.
- Search exact playable match ranks below weak/promoted matches.
- Public collections, marketplace, paid packs, Stars billing, editorial portal, owner dashboard, or station claims become visible before a separate product decision.
