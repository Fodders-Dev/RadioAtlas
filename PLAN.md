# RadioAtlas Active Roadmap

## Current Focus

Перед UI-полировкой закрываем радио-ядро: Home и Search должны поднимать станции, которые реально играют и совпадают со вкусом пользователя, без объясняющих подписей вроде "по твоим лайкам".

API proxy уже реализован и используется через `VITE_API_URL`. Текущая работа не про создание proxy, а про аккуратное использование локальных playback/playability сигналов в рекомендациях и поиске.

## Stages

- [x] Radio Core Stage 1: Clean plan source
- [x] Radio Core Stage 2: Home recommendations wiring
- [x] Radio Core Stage 3: stream playability score
- [x] Radio Core Stage 4: search ranking
- [x] Radio Core Stage 5: metadata/now-playing trust
- [x] Radio Core Stage 6: radio QA matrix

## Acceptance

- Home на 360-395px сохраняет текущую структуру: hero -> resume -> один rail.
- На Home нет видимых reason-copy: "по твоим лайкам", "Похожее на jpop", "Ты часто слушаешь Japan".
- Home использует `homeProfile.ts` и локальный playability score для выбора hero/rail.
- Search переранжирует результаты клиентски: exact/prefix выше substring, playable/verified выше слабых совпадений, taste signals помогают, promoted не перебивает явный query intent.
- Отсутствие ICY/now-playing metadata не считается плохой станцией.
- Повторно сломанные станции уходят ниже и не остаются главным hero.

## Test Plan

- `npm --workspace apps/webapp run build`
- `npm --workspace apps/webapp run test:e2e -- mobile.spec.ts`
- Если визуальные снапшоты меняются:
  - `npm --workspace apps/webapp run test:e2e -- visual.spec.ts --update-snapshots`
  - `npm --workspace apps/webapp run test:e2e -- visual.spec.ts`
