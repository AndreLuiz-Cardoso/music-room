# Segurança

## Mecanismos implementados

| Ameaça | Proteção | Onde |
|---|---|---|
| **Acesso a dados de outro usuário** | Toda rota protegida exige um JWT; cada recurso é filtrado pelo usuário (`friendsInfo` só para amigos, `privateInfo` só para o dono). Eventos/playlists privados respondem **404** (não 403) a quem não foi convidado: nem a existência vaza. IDs são UUID (não enumeráveis). | `routes/*`, `domain/policies.ts` |
| **Força bruta no login** | Rate limit de 10 req/min por IP no login, cadastro e rotas de e-mail; 300 req/min no resto, contados por usuário autenticado (numa festa, todos compartilham o IP do local) ou por IP. O IP só vem do `X-Forwarded-For` quando o proxy está declarado em `TRUST_PROXY`: senão cada cliente escolheria o seu IP e zeraria o contador. Se chega um `X-Forwarded-For` sem `TRUST_PROXY`, a API avisa no log (atrás de um proxy não declarado, todos os clientes contam como o IP do proxy). Nas rotas de autenticação a contagem é sempre por IP, mesmo com um token (um token não abre um contador novo). Bloqueio da conta por 15 min após 5 senhas erradas, com contador atômico (tentativas em paralelo também contam). Testado. | `app.ts`, `config.ts`, `routes/auth.ts` |
| **Senhas** | bcrypt (custo 12); política mínima (8+ caracteres, letra + dígito); comparação contra um hash fictício quando o e-mail não existe (o tempo de resposta não revela contas). | `routes/auth.ts` |
| **Roubo de sessão** | Access token JWT de **15 min** (HS256 fixo: tokens `alg: none` recusados) + refresh token opaco, guardado **com hash** no banco e no **Keystore/Keychain** do aparelho (`expo-secure-store`). **Rotação**: cada refresh token vale uma vez; reutilizar um token já usado revoga toda a sessão (o ladrão e a vítima são desconectados, e a vítima simplesmente entra de novo). Trocar a senha revoga todas as sessões; o aparelho que trocou recebe uma nova. | `auth/tokens.ts`, `routes/me.ts`, `mobile/src/lib/storage.ts` |
| **Reset de senha** | Token aleatório de 256 bits, guardado com hash, uso único (atômico), validade de 1 h; o reset revoga todas as sessões. | `routes/auth.ts` |
| **Enumeração de e-mails** | `register` e `forgot-password` respondem igual existindo ou não a conta (no cadastro duplicado, o dono recebe um e-mail informativo), e **no mesmo tempo**: a senha passa pelo bcrypt nos dois casos e os e-mails saem em segundo plano (esperar o servidor de e-mail só quando a conta existe revelaria quem tem conta). Testado. | `routes/auth.ts` |
| **Sequestro de conta pré-registrada** | Se alguém cadastrou o e-mail da vítima com senha e nunca confirmou, o login Google/Facebook da vítima **apaga essa senha** e revoga as sessões. | `routes/auth.ts` (`socialLogin`) |
| **Tokens sociais forjados/de outro app** | O back-end verifica ele mesmo: Google (assinatura + `audience` = nossos client ids), Facebook (`debug_token` → `app_id` = o nosso, `appsecret_proof`). | `services/social.ts` |
| **Mass assignment / payload malicioso** | Todo corpo é validado por JSON Schema; campos não declarados são **removidos** (`removeAdditional: all`); body ≤ 100 KB; respostas serializadas pelo schema (nunca sai `passwordHash`). Testado. | `schemas.ts`, `app.ts` |
| **Metadados forjados** | O app só envia o id da faixa; título/artista/URL vêm do catálogo, nunca do cliente. | `services/catalog.ts` |
| **Injeção SQL** | Prisma parametrizado; o SQL puro usa templates parametrizados (`$queryRaw\`…${x}\``); o único identificador dinâmico (nome da tabela no lock) vem de uma whitelist. | `db.ts`, `routes/events.ts` |
| **XSS nas páginas dos e-mails** | Escape de HTML + CSP estrita (`default-src 'none'`). | `views.ts` |
| **Headers HTTP** | `@fastify/helmet` (HSTS, nosniff, frame-options…); CORS fechado por padrão (lista explícita de origens). | `app.ts` |
| **WebSocket** | Handshake exige JWT válido, e o socket é fechado quando esse JWT expira (o app reconecta com um token novo, o que verifica a sessão de novo); entrar numa sala exige a mesma permissão do GET; quando um evento/playlist fica privado ou um convite é removido, os inscritos que perderam acesso são expulsos da sala. Uma delegação acaba também sem requisição (expiração, amizade desfeita): os inscritos de um aparelho são verificados de novo antes de cada envio; uma verificação que falha (banco indisponível) expulsa só aquele inscrito. Testado. | `realtime.ts`, `routes/devices.ts` |
| **Credenciais no git** | Tudo em `.env` (ignorado), modelos em `.env.example` com valores de exemplo que a API recusa (`JWT_SECRET`). Nenhuma senha nem segredo no repositório, nem na CI: o banco da CI não tem senha (descartável, só acessível ao job), o segredo JWT dos testes é sorteado a cada execução, e o banco de testes vem do `DATABASE_URL` local. As variáveis `EXPO_PUBLIC_*` só contêm identificadores públicos (client ids). | `.gitignore`, `config.ts`, `vitest.config.mts`, `ci.yml` |
| **Rastreabilidade** | Cada ação do app gera um log (usuário, rota, status, IP, duração, **plataforma, aparelho, versão do app**): no log estruturado e na tabela `ActionLog`. Os tokens de uso único dos links de e-mail são mascarados no log de requisições. | `plugins/actionLog.ts`, `app.ts` |

## Riscos identificados e proteções praticáveis (não implementadas)

| Risco | Situação atual | Proteção praticável |
|---|---|---|
| **Tráfego em claro** | A API escuta em HTTP (útil em LAN para testes). | Em produção: TLS terminado num proxy reverso (Caddy/Nginx, Let's Encrypt); HSTS já é enviado. Opcionalmente *certificate pinning* no app. |
| **Localização falsificada** (licença "no local, no horário") | A posição vem do aparelho: um GPS falso engana o servidor. | Combinar sinais: iBeacon/QR code no local (bônus IoT), detecção de mock location no Android (`isFromMockProvider`), código temporário exibido no telão. |
| **DoS do bloqueio de conta** | Um atacante pode travar a conta de alguém errando a senha 5 vezes. | Bloqueio progressivo/CAPTCHA no lugar do bloqueio total; o rate limit por IP já limita o abuso. |
| **Rate limit por IP nas rotas anônimas** | Login e cadastro continuam contados por IP: atrás de NAT (festa no mesmo Wi-Fi!), 10 logins/min para o local inteiro. | Chave e-mail + IP no login; CAPTCHA a partir de um limite. |
| **Revogação imediata de access token** | Um JWT roubado vale até 15 min após o logout (na API e no WebSocket). | Lista de revogação em Redis ou `tokenVersion` no usuário verificado a cada requisição (custo: uma leitura por requisição). |
| **Aparelho comprometido (root/jailbreak)** | SecureStore pode ser lido num aparelho com root. | Play Integrity / App Attest; vincular o refresh token ao aparelho. |
| **Abuso do catálogo externo** | A busca chama o Deezer a cada pedido (com cache de faixas). | Cache das buscas, limite específico na rota de busca. |
| **Logs com dados pessoais** | Logs guardam IP e id de usuário. | Retenção limitada (ex.: 30 dias) e purga automática (LGPD/RGPD). |
| **Dependências vulneráveis** | — | `npm audit` / Dependabot na CI. |
