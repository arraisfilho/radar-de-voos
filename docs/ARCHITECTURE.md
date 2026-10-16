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

## Persistência

Transações curtas e WAL permitem leitura durante gravações. O identificador da conta vem da sessão, e operações verificam proprietário ou papel administrativo.

Snapshots guardam a evolução do menor preço; versões separam critérios de comparação. A retenção de respostas brutas preserva as últimas tentativas/respostas válidas e os registros necessários ao histórico. Auditoria e envios possuem políticas de retenção próprias.

## Alertas e integrações

O motor registra oportunidades e aplica meta, queda mínima, silêncio e deduplicação. A fila guarda destinatários e configuração relevantes ao envio. Pausa, encerramento, troca de contatos e de integração são conferidos antes da transmissão.

E-mail usa SMTP ou Gmail API. WhatsApp usa adaptadores de `backend/integrations/`. Resultados ambíguos não são reenviados automaticamente. Aceitação de transporte é distinta de entrega ao destinatário.

Segredos ficam em arquivos privados no volume persistente; o banco e esses arquivos compõem o backup. Consulte [segurança](SECURITY_REVIEW.md) e [operação](DEPLOYMENT.md).
