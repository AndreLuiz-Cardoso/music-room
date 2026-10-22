# Arquitetura e decisões técnicas

> Cada escolha abaixo tem alternativas razoáveis. Este documento registra **por que** escolhemos a
> nossa, para que a equipe possa defendê-la (ou mudá-la) na avaliação.

## Visão geral

```
┌──────────────────────┐   REST/JSON (HTTPS)    ┌───────────────────────────┐     ┌──────────────┐
│ App mobile (Expo/RN) │ ─────────────────────▶ │ API Node.js (Fastify)     │ ──▶ │ PostgreSQL   │
│  "controle remoto"   │ ◀───────────────────── │  - validação (TypeBox)    │     │ (a verdade)  │
│                      │   Socket.IO (push)     │  - regras (domain/)       │     └──────────────┘
└──────────────────────┘                        │  - Socket.IO (tempo real) │ ──▶ API Deezer
                                                └───────────────────────────┘     (metadados + prévias 30 s)
```

- **O back-end é a referência ("a verdade")**: todo estado (filas de votação, ordem das playlists,
  estado de reprodução de cada aparelho) vive no PostgreSQL. O app só envia comandos e mostra o estado.
- **Fluxo de escrita**: o app chama a API REST → a API valida, verifica permissões e grava numa
  transação → a API envia o novo estado por WebSocket a quem está inscrito naquele recurso.
  Ao se inscrever (também depois de cada reconexão) o socket recebe o estado atual: o que foi
  enviado enquanto ele estava fora da sala não se perde.
- **O WebSocket é só de leitura** (push). Nenhuma escrita passa por ele: uma única porta de entrada
  para escrever (REST) significa um único lugar para validar, autorizar e registrar logs.

## Escolhas e justificativas

| Camada | Escolha | Por quê | Alternativas consideradas |
|---|---|---|---|
| Linguagem | **TypeScript** (back e front) | Uma linguagem só na equipe; tipos compartilhados entre API e app; ecossistema enorme | Go (mais performático, mas a equipe teria duas linguagens), Java/Spring (verboso) |
| Framework HTTP | **Fastify 5** | Rápido, validação por JSON Schema nativa, gera OpenAPI a partir dos schemas, plugins oficiais (rate-limit, helmet, CORS) | Express (sem validação/serialização nativas), NestJS (mais pesado) |
| Banco | **PostgreSQL** | Transações ACID e locks de linha (`SELECT … FOR UPDATE`) — essenciais para os problemas de concorrência do enunciado; constraints `UNIQUE` como última defesa | MongoDB (concorrência e ordenação exigem mais cuidado), SQLite (escrita concorrente fraca), Firebase (a lógica de concorrência ficaria no cliente) |
| ORM | **Prisma 6** | Schema declarativo, migrações versionadas, client tipado; SQL puro onde precisamos (locks, CTE do voto) | TypeORM, Drizzle, SQL puro |
| Tempo real | **Socket.IO** | Reconexão automática, salas (`event:<id>`), fallback; autenticação no handshake | WebSocket puro (reconexão e salas na mão), SSE (só um sentido) |
| API | **REST + JSON** | Pedido pelo enunciado; universal, cacheável, fácil de testar com curl/Swagger; JSON é nativo no JS | GraphQL (overfetching resolvido, mas mais complexo de proteger e de limitar), gRPC (binário, ruim para web/mobile simples) |
| Documentação | **OpenAPI 3 / Swagger UI** gerada dos schemas | A doc nunca diverge do código: o mesmo schema valida, serializa e documenta | Doc escrita à mão |
| Mobile | **React Native + Expo SDK 58** (Expo Router) | TypeScript como no back; roda em Android, iOS e web (base para o bônus multiplataforma); builds sem Android Studio via EAS | Flutter (Dart, segunda linguagem), Kotlin nativo (só Android) |
| Catálogo musical | **API pública Deezer** | Gratuita, sem chave, com prévias de 30 s. **O SDK não faz o nosso trabalho**: só busca metadados; votos, playlists e delegação são nossos. Os links das prévias do Deezer são assinados e expiram em 15 min: a API nunca os guarda para tocar mais tarde, ela expõe `/tracks/<id>/preview?sig=…`, que redireciona para um link novo no momento de tocar. O endereço é assinado: a rota é pública (o player de áudio não manda token), mas só consulta o Deezer para as faixas que a API guardou | Spotify (exige Premium para tocar), YouTube (ToS restritivos) |

## Modelo de dados (resumo)

Ver [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

- `User` — campos públicos (`displayName`, `avatarUrl`, `bio`, `musicPreferences`), só para amigos
  (`friendsInfo`) e privados (`privateInfo`); `googleId` / `facebookId` para contas vinculadas.
- `Friendship` — **uma linha por par** (`userAId < userBId`, `UNIQUE`): dois pedidos cruzados
  simultâneos não criam duas linhas, viram uma amizade.
- `Event`, `EventInvite`, `EventTrack` (fila, com `score` e `status`), `Vote` (PK `(faixa, usuário)`).
- `Playlist`, `PlaylistInvite`, `PlaylistTrack` (`position` densa 0..n-1, `UNIQUE(playlist, faixa)`).
- `Device` (estado de reprodução em JSON + `version`), `DeviceDelegation` (a "licença" por aparelho).
- `RefreshToken` (hash + família de rotação), `OneTimeToken` (validação de e-mail / reset de senha, hash).
- `ActionLog` — uma linha por ação do app (plataforma, aparelho, versão).

## Concorrência (o ponto de atenção do enunciado)

### Music Track Vote — "várias pessoas votam em faixas diferentes ou na mesma"

1. **Um voto = uma linha** com chave primária `(eventTrackId, userId)`. Votar duas vezes (duplo toque,
   retry de rede) é um no-op: impossível contar em dobro.
2. **Toda escrita num evento começa travando a linha do evento** (o primeiro comando é o
   `UPDATE … version = version + 1`). Os locks são sempre pegos na mesma ordem (evento → faixas), o que
   **elimina deadlocks**. (Uma primeira versão travava faixa → evento no voto e evento → faixa na sugestão:
   os testes de corrida pegaram deadlocks reais `40P01` — ver histórico em [RAMPUP.md](RAMPUP.md).)
3. **O voto é um único comando SQL** (CTE: insere o voto e incrementa o placar só se a linha foi
   realmente inserida e se a faixa ainda está na fila). As verificações de permissão rodam **antes** da
   transação, então o lock dura só dois comandos curtos.
4. **Sugestões simultâneas da mesma faixa** viram uma única entrada com N votos (a sugestão roda com o
   evento travado, então a busca "essa faixa já está na fila?" é confiável).
5. **Voto × "próxima faixa"**: se a faixa começou a tocar enquanto alguém votava, o voto é recusado
   com `409 TRACK_NOT_QUEUED` (nada é contado numa faixa que já saiu da fila).
6. **Desempate determinístico**: placar desc, depois ordem de sugestão, depois id.
7. Cada estado tem um **`version`**: o app ignora mensagens mais antigas do que o que já exibe
   (a resposta REST e o push WebSocket podem chegar em qualquer ordem).

### Music Playlist Editor — "várias pessoas movem faixas diferentes ou a mesma"

1. **Edições serializadas por playlist** com `SELECT … FOR UPDATE` na linha da playlist; posições
   sempre densas (0..n-1), reescritas num único `UPDATE … FROM unnest(...)`.
2. **Movimentos relativos a uma âncora** ("coloque X depois de Y", `null` = topo), não a um índice
   calculado numa cópia possivelmente desatualizada. Dois usuários movendo faixas *diferentes* ao mesmo
   tempo obtêm **os dois** o que pediram, qualquer que seja a ordem de aplicação (testado:
   [`services.test.ts`](../backend/test/services.test.ts)).
3. A **mesma** faixa movida por dois usuários: a última operação aplicada vence (comportamento esperado
   de um editor colaborativo).
4. Se a âncora foi removida entretanto → `409 ANCHOR_NOT_FOUND`; o app recarrega e o usuário refaz.
5. A mesma faixa adicionada por duas pessoas ao mesmo tempo → uma entrada + um `409` (constraint `UNIQUE`).
6. Teste de "tempestade": 60 movimentos aleatórios concorrentes de 8 editores → posições continuam
   0..11 sem buracos nem duplicatas, `version` exatamente +60.

### Music Control Delegation

- O estado de reprodução é do servidor; dono e amigos delegados enviam **comandos** (`PLAY`, `NEXT`,
  `SET_VOLUME`, `PLAY_PLAYLIST`…). Cada comando trava a linha do aparelho e passa por uma máquina de
  estados pura ([`domain/playback.ts`](../backend/src/domain/playback.ts)): 6 "próxima" simultâneos = 6 avanços,
  nenhuma atualização perdida.
- **Licença por aparelho**: cada `Device` tem sua lista de amigos autorizados, com expiração opcional.
  Só amigos podem receber; desfazer a amizade revoga as delegações; `PLAY_PLAYLIST` exige que quem comanda
  possa ver a playlist (a delegação não dá acesso a playlists privadas do dono).

### Tempo real em rajadas

O broadcast é **agrupado** (no máximo um envio a cada 100 ms por sala): numa festa com centenas de votos
por segundo, o servidor recarrega e envia o estado ~10×/s em vez de uma vez por voto. O cliente sempre
recebe o estado mais recente (com sua `version`).

### Protocolo de tempo real

O canal Socket.IO só envia: toda mudança passa pela API REST, que depois transmite o novo estado aos
inscritos. O cliente se inscreve emitindo `subscribe` com o nome de uma sala (`event:<id>`,
`playlist:<id>` ou `device:<id>`), o que exige a mesma permissão de leitura do GET correspondente, e sai
com `unsubscribe`. Ao se inscrever, recebe primeiro o estado atual e depois a confirmação `{ ok: boolean }`.
O servidor envia `event:state`, `playlist:state` e `device:state` (o mesmo objeto do GET) e
`<tipo>:deleted` quando o recurso é apagado.

## Organização do código

```
backend/
  prisma/              schema + migrações SQL versionadas
  src/
    domain/            regras puras, sem I/O, 100% testáveis (permissões, ordenação, máquina de estados)
    routes/            um arquivo por recurso: validação, autorização, transação, broadcast
    services/          integrações (Deezer, SMTP, Google/Facebook) atrás de interfaces (injetáveis nos testes)
    auth/tokens.ts     JWT de acesso + refresh tokens com rotação
    realtime.ts        Socket.IO: autenticação, salas, revalidação de permissões
    plugins/actionLog  logs de todas as ações
  test/                testes unitários (domain) e de integração (API + PostgreSQL real)
  load/                teste de carga (autocannon)
mobile/
  src/app/             telas (Expo Router: um arquivo = uma rota)
  src/lib/             cliente da API, sessão, tempo real, login social
  src/components/      UI compartilhada, player do aparelho
```

Cada regra é escrita uma vez só, e todo o resto a usa:

| Regra | Onde |
|---|---|
| Quem vê um evento ou uma playlist (em memória e como filtro das listas) | `domain/policies.ts`: `canSee`, `visibleWhere` |
| Cópia de uma faixa do catálogo (gravação e exibição, endereço da prévia assinado) | `services/catalog.ts`: `toStoredTrack`, `fromStoredTrack`, `previewAddress` |
| E-mail em minúsculas, usuário existente, lista de convidados | `services/users.ts`: `normalizeEmail`, `findUserByEmail`, `ensureUser`, `invitees` |
| Campos comuns dos schemas (perfil, faixa, filtro das listas) | `schemas.ts`: `ProfileFields`, `CatalogFields`, `ListQuery` |
| Telas de eventos e playlists: rótulos de visibilidade/licença, convidados, busca nas listas, exclusão | `mobile/src/components/shared.tsx`, `mobile/src/lib/hooks.ts` (`useListSearch`, `confirmDelete`) |

## Testes por camada

| Camada | O quê | Onde |
|---|---|---|
| Domínio | regras de visibilidade/licença, distância, ordenação por âncora, máquina de estados | `test/domain.test.ts` |
| API + banco | cadastro/validação/reset, rotação de tokens, força bruta, privacidade do perfil, mass assignment, as 3 licenças, concorrência (votos, sugestões, movimentos, comandos), tempo real | `test/auth.test.ts`, `test/services.test.ts` |
| Carga | 4 cenários × 4 níveis de concorrência | `load/run.ts` → [RAMPUP.md](RAMPUP.md) |
| App | typecheck estrito + lint (regras do React Compiler) + bundle Android/web | `npm run lint` |
| CI | tudo acima (exceto carga) em cada push | `.github/workflows/ci.yml` |
