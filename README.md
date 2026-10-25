# Music Room

Solução mobile colaborativa em torno da música (projeto Music Room, 42).

- **Music Track Vote**: numa festa, todos sugerem e votam; a faixa mais votada toca em seguida.
  Eventos públicos ou privados, com três licenças de voto: todos, só convidados, ou só quem está
  **no local e no horário**.
- **Music Playlist Editor**: edição de playlists em tempo real, a várias mãos. Playlists públicas ou
  privadas; edição aberta a todos ou só a convidados.
- **Music Control Delegation**: cada aparelho conectado à conta pode ser controlado por amigos
  escolhidos, **aparelho por aparelho**, com expiração opcional.

| | |
|---|---|
| Back-end | Node.js 22 · TypeScript · Fastify 5 · Prisma · PostgreSQL · Socket.IO |
| API | REST + JSON, documentação OpenAPI/Swagger em `/docs` ([`docs/openapi.json`](docs/openapi.json)) |
| Mobile | React Native · Expo SDK 58 · Expo Router (Android, iOS e web) |
| Música | API pública Deezer (busca + prévias de 30 s) |

Documentação: [arquitetura e decisões](docs/ARCHITECTURE.md) · [segurança](docs/SECURITY.md) ·
[ramp-up](docs/RAMPUP.md) · [uso de IA](docs/AI_USAGE.md)

## Pré-requisitos

- Node.js ≥ 20 e npm
- PostgreSQL: **nenhuma instalação necessária**. `make db` sobe um PostgreSQL embutido, baixado pelo
  npm. Com Docker, `make db-docker` também funciona, com as mesmas configurações (`DATABASE_URL`).
- Mobile: o app Expo Go para o básico, ou Android Studio / EAS para um *development build* (necessário
  para login Google/Facebook)

Nenhuma dependência é versionada no repositório: tudo é baixado por `make install`.
Sem `make` (Windows), use os scripts npm equivalentes: `npm run setup`, `npm run db`, `npm run dev`…

## Primeiros passos

```bash
make install                         # dependências do back-end e do app (npm ci)

cp backend/.env.example backend/.env # e defina um JWT_SECRET e a senha do banco (instruções no arquivo)
cp mobile/.env.example mobile/.env   # endereço da API, ids Google/Facebook

make db                              # terminal 1: PostgreSQL local (fica rodando)
make mail                            # terminal 2: caixa de e-mails local em http://localhost:1080
make migrate                         # cria as tabelas
make dev                             # terminal 3: API em http://localhost:3000 (Swagger em /docs)
make mobile                          # terminal 4: app (a = Android, w = web)
```

Os e-mails (validação de conta, redefinição de senha) chegam à **caixa local de `make mail`**, em
http://localhost:1080: nenhum cadastro num provedor, nada sai da máquina. Abra o link do e-mail neste
computador (ele aponta para `PUBLIC_URL`). Sem `SMTP_HOST` no `.env`, eles aparecem no log da API.

Em builds de desenvolvimento, o endereço da API pode ser alterado abrindo `/server` (no web:
http://localhost:8081/server), para testar contra outro servidor.
No emulador Android, `localhost` do PC é `http://10.0.2.2:3000` (o valor do `.env.example`); o app web e o
simulador iOS usam `localhost` com o mesmo `.env`. Num celular, use o IP da máquina na rede.

### Sem espaço na home (`ENOSPC`)

O cache do npm fica em `~/.npm` e enche rápido uma home pequena (as da 42): o `npm ci` falha com
`ENOSPC: no space left on device`. Mova o cache para o goinfre e apague o antigo:

```bash
npm config set cache /goinfre/$USER/.npm-cache   # gravado em ~/.npmrc, vale para todos os projetos
rm -rf ~/.npm/_cacache ~/.npm/_logs              # é só cache: o npm baixa de novo o que precisar
```

O goinfre é local a cada máquina e pode ser limpo: na pior das hipóteses o npm baixa os pacotes de novo.
Para manter o cache entre máquinas, use `/sgoinfre/$USER/.npm-cache`. Depois, rode `make install` de novo.

### Login Google / Facebook

As bibliotecas oficiais têm código nativo: elas funcionam num *development build*, não no Expo Go.

1. **Google** (console.cloud.google.com): crie um OAuth client **Web** e um client **Android**
   (package `com.musicroom.app` + SHA-1 da chave de debug). Coloque o client id **Web** em
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (mobile) e em `GOOGLE_CLIENT_IDS` (backend).
2. **Facebook** (developers.facebook.com): crie um app com "Facebook Login". Preencha
   `EXPO_PUBLIC_FACEBOOK_APP_ID` + `FACEBOOK_CLIENT_TOKEN` (mobile) e `FACEBOOK_APP_ID` +
   `FACEBOOK_APP_SECRET` (backend).
3. `make android` (ou `cd mobile && npx expo run:android`).

O app recebe uma credencial do Google/Facebook, mas é o **back-end** que a verifica junto ao provedor.

## Testes

```bash
make test     # 84 testes: regras de domínio + integração API/PostgreSQL (concorrência, segurança, tempo real)
make lint     # typecheck back e app + lint do app
make load     # teste de carga (ver docs/RAMPUP.md)
make e2e      # o app web num navegador de verdade, no modo UI do Playwright (tempo real, áudio, sessão)
make e2e-cli  # os mesmos checks no terminal (~1 min)
```

Os testes criam e migram sozinhos um banco `musicroom_test` (configurável via `TEST_DATABASE_URL`).
A CI (GitHub Actions) roda typecheck, testes, build e lint a cada push.

`make e2e` precisa da API (`make dev`) e do app (`make mobile`, que também serve o app web) rodando. Ele
cria três contas, usa o app como usuários de verdade (Playwright + Chromium, com a política de autoplay
real do navegador) e apaga as contas no fim. Abre o **modo UI do Playwright**: a lista dos checks, que se
rodam todos ou um por um, com a linha do tempo de cada passo (capturas, DOM, rede) e a opção de ver o
navegador agindo. `make e2e-cli` roda os mesmos checks no terminal e gera um relatório HTML
(`cd e2e && npx playwright show-report`). A verificação da expiração do WebSocket, que leva 16 minutos,
fica no projeto `slow`: marque-a no modo UI ou rode `cd e2e && npm run checks:slow`. Numa distribuição Linux que o Playwright ainda não conhece,
defina `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`.

## Estrutura

```
backend/   API (src/), schema e migrações (prisma/), testes (test/), carga (load/)
mobile/    app Expo (src/app = telas, src/lib = cliente API / sessão / tempo real)
docs/      arquitetura, segurança, ramp-up, uso de IA, openapi.json
```

## Logs

Toda ação feita no app gera um log no back-end com **plataforma, aparelho e versão do app** (headers
`X-Client-*` enviados pelo app). O log vai para a saída estruturada (pino) e para a tabela `ActionLog`.

## Segredos

Todas as credenciais ficam em arquivos `.env` locais, ignorados pelo git. Só os modelos
`.env.example` são versionados.
