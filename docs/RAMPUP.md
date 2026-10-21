# Ramp-up: carga suportada

## Como medir

```bash
# terminal 1: banco
make db                    # ou npm run db
# terminal 2: API em modo produção, catálogo offline e rate limit desativado
#            (o benchmark sai de um único IP, que o rate limit bloquearia)
cd backend && npm run build
NODE_ENV=production TRACK_CATALOG=fake RATE_LIMIT_MAX=100000000 npm start
# terminal 3: rampa de carga (autocannon)
make load                  # LOAD_DURATION=30 LOAD_STEPS=50,100,400 LOAD_URL=http://host:3000 também funcionam
```

O script ([`backend/load/run.ts`](../backend/load/run.ts)) cria 500 usuários, um evento com 50 faixas,
uma playlist com 50 faixas e um aparelho delegado a 50 amigos. Depois mede 4 cenários, cada um com
10, 50, 100 e 200 conexões simultâneas. **Cada requisição usa um usuário sorteado.** O resultado bruto
fica em `backend/load/results.json`.

Os cenários são de **pior caso**: todos os usuários disputam **o mesmo** evento, a mesma playlist e o
mesmo aparelho. Os locks são por recurso, então eventos diferentes não se bloqueiam.

## Máquina de teste

| | |
|---|---|
| Tipo | Notebook pessoal (on-premise), **não** é um servidor |
| CPU | Intel Core i7-8550U, 4 núcleos / 8 threads, 1,8 GHz (turbo 4 GHz) |
| RAM | 8 GB |
| SO | Windows 10 (19045) |
| Software | Node.js 22.23, PostgreSQL 18.4 (embutido), Prisma 6.19, pool de 20 conexões |
| Observação | API, PostgreSQL **e** gerador de carga rodam na mesma máquina e disputam a mesma CPU |

## Resultados (10 s por degrau, 2026-10-21)

| Cenário | Conexões | Req/s | p50 | p99 | Erros |
|---|---:|---:|---:|---:|---:|
| Leitura da fila (`GET /events/:id`) | 10 | 244 | 39 ms | 80 ms | 0 % |
| | 50 | 276 | 173 ms | 258 ms | 0 % |
| | 100 | 309 | 303 ms | 554 ms | 0 % |
| | 200 | 310 | 615 ms | 864 ms | 0 % |
| **Track Vote**: voto | 10 | 160 | 52 ms | 237 ms | 0 % |
| | 50 | 153 | 255 ms | 1003 ms | 0 % |
| | 100 | 156 | 562 ms | 1323 ms | 0 % |
| | 200 | 149 | 1217 ms | 2441 ms | 0 % |
| **Playlist Editor**: mover faixa | 10 | 64 | 67 ms | 750 ms | 0 % |
| | 50 | 69 | 653 ms | 1187 ms | 0 % |
| | 100 | 69 | 1211 ms | 2605 ms | 0 % |
| | 200 | 56 | 3055 ms | 6371 ms | 0 % |
| **Control Delegation**: comando | 10 | 111 | 53 ms | 374 ms | 0 % |
| | 50 | 141 | 339 ms | 791 ms | 0 % |
| | 100 | 145 | 536 ms | 1451 ms | 0 % |
| | 200 | 112 | 1589 ms | 3458 ms | 0 % |

## Interpretação: quantos usuários simultâneos?

- **Conexões ≠ usuários.** Uma conexão do autocannon dispara requisições sem pausa. Um convidado de
  festa vota talvez **uma vez a cada 30 s**, e as atualizações chegam por WebSocket, sem polling.
- O **voto** sustenta ~**150 votos/s num único evento** sem erros. Com 1 voto a cada 30 s por pessoa,
  isso dá **~4 500 votantes ativos no mesmo evento**. Em eventos diferentes os locks não se cruzam, e o
  limite passa a ser a CPU.
- Com a CPU dividida entre API, banco e gerador, a vazão total fica entre 150 e 300 req/s conforme a
  operação. Para uma **mistura realista** (1 ação a cada 30 s por usuário, metade leituras) estimamos,
  de forma conservadora, **~3 000 usuários simultâneos usando os 3 serviços neste notebook**, com
  latência mediana abaixo de 300 ms.
- A **edição de playlist** é a operação mais cara (reescreve posições sob lock), mas 200 pessoas movendo
  faixas da **mesma** playlist ao mesmo tempo não é um cenário realista.
- Coerente com o enunciado: "milhares para um servidor modesto". Num Raspberry Pi 4 esperamos algumas
  dezenas a poucas centenas de usuários.

## O que os testes de carga mudaram no código

O teste de carga e os testes de corrida orientaram três mudanças (antes → depois, 200 conexões):

1. **Voto: 58 → 149 req/s, erros 32 % → 0 %.** A primeira versão travava o evento durante toda a
   transação e recarregava o estado completo duas vezes por voto. Agora as permissões são verificadas
   antes da transação, o voto é um único comando SQL e o broadcast é agrupado (no máximo 10/s por sala).
2. **Deadlocks eliminados.** Uma versão intermediária travava faixa → evento no voto e evento → faixa na
   sugestão. Os testes de corrida provocaram `deadlock detected (40P01)` e esgotaram o pool de conexões.
   Correção: ordem de lock única (evento primeiro) e `maxWait` do pool ajustado.
3. **Playlist: 49 req/s com 60 % de erros → 56 req/s com 0 %.** A renumeração das posições virou um único
   `UPDATE … FROM unnest(…)` em vez de um `UPDATE` por faixa.

## Próximos passos para escalar

- **Mais CPU / processos**: rodar N instâncias da API (cluster/PM2) atrás de um balanceador. O
  Socket.IO precisa então do adapter Redis para compartilhar as salas.
- **Banco dedicado**: PostgreSQL numa máquina separada; `connection_limit` ajustado; PgBouncer.
- **Leituras**: cache de curta duração do estado de um evento (o mesmo estado é lido por todos).
- **Ainda não medido**: o número máximo de conexões WebSocket simultâneas e o custo do broadcast para
  N inscritos. Ferramentas possíveis: `artillery` com o engine socket.io, ou um script com `socket.io-client`.
