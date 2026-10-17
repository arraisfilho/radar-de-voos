# Arquitetura

## Componentes

| Componente | Função |
|---|---|
| React, TypeScript e Vite | Interface responsiva e build estático |
| TanStack Query | Cache de estado e atualização condicional por área |
| FastAPI | API, sessões, autorização e arquivos da interface |
| SQLite/WAL | Contas, buscas, resultados, preços, alertas e filas |
| Coletor | Agendamento e consultas de tarifas via `fast-flights` |
| Trabalhadores de envio | Processamento de e-mail e WhatsApp |

A API serve o frontend no mesmo domínio. O proxy externo termina HTTPS. Uma instância da aplicação executa um coletor e os trabalhadores; não há coordenação entre réplicas.

## Coleta e filtros

O agendador gera combinações de trecho, aeroporto e data. A coleta tem concorrência limitada, timeout e cadência de cinco minutos, sujeita à fila. Atualizar a interface não dispara consultas à fonte.

Filtros são aplicados no servidor antes de calcular preços e alertas. A prévia no navegador reutiliza resultados disponíveis. Alterar filtros cria uma versão; respostas compatíveis podem ser reaproveitadas sem inventar uma nova coleta ou alerta. Dados de aquisição incompatíveis exigem nova consulta.

Uma falha conserva a última resposta válida para exibição como desatualizada. A direção incompleta não gera comparação de preço. O parser distingue resposta vazia de falha, mas depende de um formato externo sujeito a mudanças.

Cada falha de consulta recebe um `kind`, gravado com o erro na resposta da rota e, para o tipo predominante do ciclo, em `searches.error_kind`:

| `kind` | Origem |
|---|---|
| `rate_limited` | HTTP 429 |
| `blocked` | HTTP 403, página de consentimento, captcha ou aviso de tráfego incomum |
| `format` | Estrutura de topo da resposta fora do esperado: marcador de dados ausente, JSON inválido, grupos de voos ausentes ou malformados, ou bloco de companhias (posição 7) inválido |
| `no_results` | Página sem bloco de voos, status de erro da fonte para aquela consulta (`errorHasStatus`) ou nenhum itinerário legível e válido |
| `timeout`, `network`, `server`, `unknown` | Tempo esgotado, conexão, HTTP 5xx e demais falhas |

Os itinerários são lidos um a um: um item malformado é pulado e contado em `skipped` (`malformed_itinerary`), sem descartar os demais.

Três falhas globais seguidas (`rate_limited`, `blocked` ou `format`), vindas de pelo menos duas rotas (origem-destino) diferentes, abrem o disjuntor da fonte, persistido na tabela `metadata`: nenhuma consulta começa até `retry_at`, após 5, 10, 20, 40 e no máximo 60 minutos, com variação de ±20%. Várias buscas da mesma rota, por exemplo em datas diferentes, contam como uma rota. Depois desse horário, uma única consulta de teste é liberada: sucesso, ou `no_results` (a fonte respondeu), fecha o disjuntor e zera a espera; as demais falhas, inclusive de rota (`timeout`, `network` etc.), reabrem no degrau seguinte com o `kind` dessa falha. Cada liberação carrega a geração do disjuntor: enquanto ele não está fechado, resultados de consultas liberadas antes (antes da abertura, ou de um teste cujo prazo de 2 minutos expirou) não o fecham nem o reabrem. Rotas não consultadas, por pausa da fonte ou porque a busca foi pausada, encerrada ou editada durante o ciclo, mantêm o último resultado, deixam a direção incompleta e marcam o ciclo como `interrupted`. Uma nova `ADAPTER_VERSION` zera o disjuntor; reiniciar a aplicação não.

O recuo por busca conta ciclos sem nenhuma consulta bem-sucedida: o próximo ciclo usa a cadência multiplicada por min(2^(n−1), 12), com variação de ±20% e nunca abaixo da cadência; qualquer sucesso, mesmo com outras rotas falhando, zera a contagem. Contam as falhas `network`, `timeout`, `server`, `no_results` e `unknown` e, enquanto o disjuntor continua fechado, também as globais, porque uma rota sozinha não o abre. Um ciclo interrompido pela pausa não altera a contagem. Reiniciar a aplicação mantém o recuo: o próximo ciclo fica no mais tarde entre agora, cinco minutos após o último início e o horário já agendado. Contagens gravadas por versões anteriores, que somavam qualquer ciclo com rota falhando, são zeradas uma única vez na migração.

O estado da fonte (`ok`, `degraded` ou `paused`) aparece em `/api/state` e `/api/health` e reúne as consultas de todas as buscas: `degraded` indica falhas seguidas de qualquer tipo, a última há até 30 minutos, e `consecutive_failures` conta todas elas, inclusive o teste que fechou o disjuntor com `no_results`; `paused` inclui a reabertura causada por um teste que falhou por motivo de rota. Em `/api/health`, o estado da fonte só vai para o loopback e para sessão de administrador ([operação](DEPLOYMENT.md#verificação-inicial)).

## Persistência

Transações curtas e WAL permitem leitura durante gravações. O identificador da conta vem da sessão, e operações verificam proprietário ou papel administrativo.

Snapshots guardam a evolução do menor preço; versões separam critérios de comparação. A retenção de respostas brutas preserva as últimas tentativas/respostas válidas e os registros necessários ao histórico. Auditoria e envios possuem políticas de retenção próprias, aplicadas pela manutenção horária do coletor; a auditoria agrega eventos anônimos e sessões repetidos (sessões, só do mesmo navegador) e limita separadamente eventos anônimos, de conta e administrativos ([operação](DEPLOYMENT.md#logs-e-retenção)).

## Alertas e integrações

O motor registra oportunidades e aplica meta, queda mínima, silêncio e deduplicação. A fila guarda destinatários e configuração relevantes ao envio. Pausa, encerramento, troca de contatos e de integração são conferidos antes da transmissão.

E-mail usa SMTP ou Gmail API. WhatsApp usa adaptadores de `backend/integrations/`. Resultados ambíguos não são reenviados automaticamente. Aceitação de transporte é distinta de entrega ao destinatário.

Segredos ficam em arquivos privados no volume persistente; o banco e esses arquivos compõem o backup. Consulte [segurança](SECURITY_REVIEW.md) e [operação](DEPLOYMENT.md).
