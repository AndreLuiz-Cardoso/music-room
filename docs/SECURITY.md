# Segurança

## Mecanismos implementados

| Ameaça | Proteção | Onde |
|---|---|---|
| **Acesso a dados de outro usuário** | Toda rota protegida exige um JWT; cada recurso é filtrado pelo usuário (`friendsInfo` só para amigos, `privateInfo` só para o dono). Eventos/playlists privados respondem **404** (não 403) a quem não foi convidado: nem a existência vaza. IDs são UUID (não enumeráveis). | `routes/*`, `domain/policies.ts` |
| **Força bruta no login** | Rate limit por IP (10 req/min nas rotas `/auth/*`, 300 req/min no resto) + bloqueio da conta por 15 min após 5 senhas erradas. | `app.ts`, `routes/auth.ts` |
| **Senhas** | bcrypt (custo 12); política mínima (8+ caracteres, letra + dígito); comparação contra um hash fictício quando o e-mail não existe (o tempo de resposta não revela contas). | `routes/auth.ts` |
| **Roubo de sessão** | Access token JWT de **15 min** (HS256 fixo: tokens `alg: none` recusados) + refresh token opaco, guardado **com hash** no banco e no **Keystore/Keychain** do aparelho (`expo-secure-store`). **Rotação**: cada refresh token vale uma vez; reutilizar um token já usado revoga toda a sessão (o ladrão e a vítima são desconectados, e a vítima simplesmente entra de novo). | `auth/tokens.ts`, `mobile/src/lib/storage.ts` |
| **Reset de senha** | Token aleatório de 256 bits, guardado com hash, uso único (atômico), validade de 1 h; o reset revoga todas as sessões. | `routes/auth.ts` |
| **Enumeração de e-mails** | `register` e `forgot-password` respondem igual existindo ou não a conta (no cadastro duplicado, o dono recebe um e-mail informativo). | `routes/auth.ts` |
| **Sequestro de conta pré-registrada** | Se alguém cadastrou o e-mail da vítima com senha e nunca confirmou, o login Google/Facebook da vítima **apaga essa senha** e revoga as sessões. | `routes/auth.ts` (`socialLogin`) |
| **Tokens sociais forjados/de outro app** | O back-end verifica ele mesmo: Google (assinatura + `audience` = nossos client ids), Facebook (`debug_token` → `app_id` = o nosso, `appsecret_proof`). | `services/social.ts` |
| **Mass assignment / payload malicioso** | Todo corpo é validado por JSON Schema; campos não declarados são **removidos** (`removeAdditional: all`); body ≤ 100 KB; respostas serializadas pelo schema (nunca sai `passwordHash`). Testado. | `schemas.ts`, `app.ts` |
| **Metadados forjados** | O app só envia o id da faixa; título/artista/URL vêm do catálogo, nunca do cliente. | `services/catalog.ts` |
| **Injeção SQL** | Prisma parametrizado; o SQL puro usa templates parametrizados (`$queryRaw\`…${x}\``); o único identificador dinâmico (nome da tabela no lock) vem de uma whitelist. | `db.ts`, `routes/events.ts` |
| **XSS nas páginas dos e-mails** | Escape de HTML + CSP estrita (`default-src 'none'`). | `views.ts` |
| **Headers HTTP** | `@fastify/helmet` (HSTS, nosniff, frame-options…); CORS fechado por padrão (lista explícita de origens). | `app.ts` |
| **WebSocket** | Handshake exige JWT válido; entrar numa sala exige a mesma permissão do GET; quando um evento/playlist fica privado ou um convite é removido, os inscritos que perderam acesso são expulsos da sala. | `realtime.ts` |
| **Credenciais no git** | Tudo em `.env` (ignorado), modelos em `.env.example`. As variáveis `EXPO_PUBLIC_*` só contêm identificadores públicos (client ids). | `.gitignore` |
| **Rastreabilidade** | Cada ação do app gera um log (usuário, rota, status, IP, duração, **plataforma, aparelho, versão do app**): no log estruturado e na tabela `ActionLog`. | `plugins/actionLog.ts` |

## Riscos identificados e proteções praticáveis (não implementadas)

| Risco | Situação atual | Proteção praticável |
|---|---|---|
| **Tráfego em claro** | A API escuta em HTTP (útil em LAN para testes). | Em produção: TLS terminado num proxy reverso (Caddy/Nginx, Let's Encrypt); HSTS já é enviado. Opcionalmente *certificate pinning* no app. |
| **Localização falsificada** (licença "no local, no horário") | A posição vem do aparelho: um GPS falso engana o servidor. | Combinar sinais: iBeacon/QR code no local (bônus IoT), detecção de mock location no Android (`isFromMockProvider`), código temporário exibido no telão. |
| **DoS do bloqueio de conta** | Um atacante pode travar a conta de alguém errando a senha 5 vezes. | Bloqueio progressivo/CAPTCHA no lugar do bloqueio total; o rate limit por IP já limita o abuso. |
| **Rate limit por IP** | Atrás de NAT (festa no mesmo Wi-Fi!), todos compartilham o IP. | Limite por usuário autenticado (chave = `userId`) nas rotas protegidas; limites mais altos para o caminho de voto. |
| **Revogação imediata de access token** | Um JWT roubado vale até 15 min após o logout. | Lista de revogação em Redis ou `tokenVersion` no usuário verificado a cada requisição (custo: uma leitura por requisição). |
| **Aparelho comprometido (root/jailbreak)** | SecureStore pode ser lido num aparelho com root. | Play Integrity / App Attest; vincular o refresh token ao aparelho. |
| **Abuso do catálogo externo** | A busca chama o Deezer a cada pedido (com cache de faixas). | Cache das buscas, limite específico na rota de busca. |
| **Logs com dados pessoais** | Logs guardam IP e id de usuário. | Retenção limitada (ex.: 30 dias) e purga automática (LGPD/RGPD). |
| **Dependências vulneráveis** | — | `npm audit` / Dependabot na CI. |
