# Uso de IA neste projeto

O enunciado (capítulo II) pede transparência sobre o uso de IA e que a equipe mantenha a liderança
intelectual do projeto. Este arquivo registra o que foi feito com IA, para que a avaliação e a equipe
saibam exatamente o que revisar e assumir.

## O que foi gerado por IA

A **primeira versão completa do código e da documentação** foi gerada com o **Claude Code** (modelo
Claude Opus 5.5, Anthropic) a partir do enunciado:

- back-end inteiro (`backend/`): schema do banco, rotas, regras de concorrência, autenticação, testes,
  script de carga;
- app mobile (`mobile/src/`), sobre o template oficial `create-expo-app`;
- `docs/`, `README.md`, `Makefile`, CI.

## Decisões tomadas pela equipe

Antes de qualquer código, a IA apresentou as alternativas e **a equipe escolheu**:

| Decisão | Escolha da equipe |
|---|---|
| Back-end | Node.js + TypeScript |
| Mobile | React Native + Expo |
| Banco de dados | PostgreSQL |
| Serviços | os 3 (Track Vote, Playlist Editor, Control Delegation) |

## O que foi verificado (e como)

- 58 testes automatizados (unitários + integração em PostgreSQL real), todos passando, executados
  várias vezes seguidas para descartar instabilidade.
- Teste ponta a ponta manual via curl contra o servidor real (cadastro, link de e-mail, login, busca no
  Deezer, evento, sugestão).
- Teste de carga medido de verdade nesta máquina ([RAMPUP.md](RAMPUP.md)).
- Os testes encontraram defeitos reais no código gerado, que foram corrigidos: deadlock entre voto e
  sugestão, esgotamento do pool de conexões, desempenho do voto e da reordenação de playlist.

## O que **não** foi verificado

- **Login Google e Facebook num aparelho real.** Exige criar os apps nos consoles do Google e do
  Facebook, preencher os `.env` e gerar um development build (`npx expo run:android`). O código segue a
  documentação atual das bibliotecas, mas nunca foi executado de ponta a ponta.
- **O app rodando num emulador ou celular.** O app passa no typecheck, no lint e no bundle Metro para
  Android/web, mas as telas não foram usadas por um humano.
- **Envio real de e-mails por SMTP.** Testado só com o mailer de console.

## O que a equipe precisa fazer antes da defesa

1. **Ler e entender cada arquivo**, em especial `backend/src/routes/events.ts`,
   `backend/src/routes/playlists.ts`, `backend/src/auth/tokens.ts` e `docs/ARCHITECTURE.md`. Na
   avaliação, cada decisão precisa ser explicada por vocês.
2. Testar o app num aparelho e corrigir o que aparecer.
3. Configurar e testar o login social (é obrigatório).
4. Refazer o teste de carga na máquina da defesa e atualizar `RAMPUP.md`.
5. Dividir as partes entre os membros da equipe, como o enunciado recomenda, para que cada um domine
   uma camada.
6. Questionar as escolhas: onde a equipe discordar, mudar e registrar o motivo.
