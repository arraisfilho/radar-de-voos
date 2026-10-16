# Análise de referência — Radar de Voos

Inspeção realizada em 16/10/2026: https://erp.axqi.ai/voos/

## Escopo e evidência

O site abriu com uma sessão autenticada existente. Foram examinados o painel, os formulários de criação e edição, o calendário, o atalho de período, as opções de alerta, o gerenciamento de destinatários e o histórico. Nenhuma busca foi salva, removida ou alterada; nenhum alerta foi enviado.

Esta é uma análise funcional pela interface. Não houve acesso ao repositório, banco de dados ou infraestrutura. O fluxo de login não foi exercitado. Frequência de coleta e entrega de mensagens são informações exibidas pelo produto, sem auditoria independente nesta inspeção.

## 1. Produto observado

O produto acompanha preços de passagens e avisa sobre oportunidades. A jornada principal é: configurar uma viagem → monitorar tarifas → comparar opções → receber alerta → abrir uma pesquisa externa para comprar.

| Área | Comportamento observado |
|---|---|
| Conta | Sessão associada a telefone; exibição parcialmente mascarada e opção de sair. O método de autenticação não foi verificado. |
| Buscas | Várias buscas salvas, seleção da busca ativa, criação, edição e remoção disponíveis na interface. |
| Trecho | Seleção de múltiplos aeroportos em origem e destino; botão para inverter o trecho. |
| Datas | Dias individuais, seleção múltipla, intervalo e volta opcional. Dias passados desabilitados no calendário examinado. |
| Flexibilidade | Datas escolhidas ou comparação de até cinco dias antes/depois. |
| Orçamento | Preço-alvo opcional, definido por adulto e por trecho. A ajuda informa alerta também na primeira consulta se o preço já estiver dentro da meta. |
| Passageiros | Contador de adultos e cabine econômica. Não observei seleção de crianças ou outras cabines. |
| Filtros | GOL, LATAM, Azul, botão para outras companhias, voos diretos e opção de cidade oculta. A coleta desta última modalidade não foi testada. |
| Resultados | Até cinco menores preços por dia, seções separadas de ida e volta, companhia, aeroportos, saída e preço por adulto. |
| Resumo | Menor preço por trecho, comparação de datas e quantidade de dias monitorados. |
| Atualização | Interface anuncia monitoramento a cada cinco minutos e mostra contagem regressiva. |
| Alertas | Controles de WhatsApp, notificações no celular, alarme sonoro e instalação de aplicativo. Instalação e permissões não foram acionadas. |
| Destinatários | Até cinco números por conta; a tela informa que todos recebem alertas de todas as buscas. |
| Histórico | Valores no momento do alerta, preço anterior, itinerário e status de entrega; limite informado de 200 registros dos últimos 90 dias. |
| Encerramento | Aviso de encerramento automático após as datas da busca, incluindo volta e flexibilidade; histórico preservado. |
| Compra | Links para Google Flights. Os links examinados codificam uma pesquisa de trecho/data, sem evidência de reserva garantida da tarifa exibida. |
| Navegação | Barra inferior com Minhas buscas, Novo voo, Novo período e Histórico. Novo período abriu o editor da busca existente. |

## 2. Interface e oportunidades de melhoria

O visual usa fundo escuro, cartões com bordas arredondadas, destaques em azul e preço como principal elemento dos resultados. A organização por dia facilita comparar alternativas, e os resumos evitam exigir a leitura de todos os voos.

Para um novo produto, eu faria estes ajustes:

- Colocar o resumo das melhores oportunidades mais perto do topo; o cabeçalho e os avisos ocupam bastante altura na tela examinada.
- Mostrar cidade e aeroporto de forma consistente, evitando depender apenas de códigos como THE.
- Usar um assistente curto para configurar trecho, datas e orçamento, preservando filtros avançados em uma área opcional.
- Renomear “Novo período” para “Editar datas”, refletindo o comportamento observado.
- Exibir última coleta bem-sucedida, idade do preço e falhas do provedor, além da próxima atualização prevista.
- Destacar o custo da viagem inteira e do grupo, quando houver combinação válida. A soma dos menores trechos deve ser identificada como estimativa quando não representar uma oferta conjunta confirmada.
- Permitir escolher quais destinatários recebem cada busca.
- Diferenciar claramente histórico de preços de histórico de mensagens. Na referência, examinei histórico de alertas; não identifiquei um gráfico temporal de tarifas nas telas percorridas.

No histórico examinado, há entradas visualmente semelhantes em horários diferentes. Isso justifica projetar deduplicação e intervalo entre alertas, mas não comprova um defeito: as regras internas e os motivos de cada envio não estão disponíveis.

## 3. A decisão técnica principal: obter tarifas confiáveis

O rodapé informa “Google Flights via fast-flights 3.1.0”. O projeto fast-flights se apresenta como um scraper de Google Flights em Python. Isso não comprova a arquitetura completa do site nem torna a biblioteca uma API oficial do Google.

Fontes primárias: [pacote fast-flights](https://pypi.org/project/fast-flights/) e [repositório do autor](https://github.com/AWeirdDev/flights).

Minha recomendação é começar com uma prova de coleta, antes de investir na interface completa. Uma integração baseada em scraping pode exigir manutenção quando a fonte muda; essa é uma avaliação técnica do tipo de integração, não uma falha verificada no site.

Avaliar uma API comercial também exige conferir cobertura e preços nas rotas brasileiras pretendidas. Não assumir equivalência com Google Flights: a [documentação da Amadeus](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/) explica diferenças entre tarifas publicadas e preços de outros canais e distingue APIs de cache de buscas ao vivo.

O piloto deve medir:

1. Cobertura de GOL, LATAM e Azul nas rotas escolhidas.
2. Sucesso da coleta, tempo de resposta e falhas intermitentes.
3. Comparabilidade de moeda, taxas, passageiros, bagagem e tarifa.
4. Correspondência entre resultado exibido e pesquisa aberta pelo link.
5. Custo por busca útil e volume diário suportado.

Uma consulta sem resultados precisa ser distinguida de erro, bloqueio ou timeout. Quando a coleta falhar, preservar a última observação válida com indicação de desatualização.

## 4. MVP proposto

### Prioridade inicial

- Conta individual e autenticação com identidade verificada.
- Cadastro, edição, pausa e encerramento de buscas.
- Múltiplos aeroportos, ida/volta, datas selecionadas e meta de preço.
- Coleta agendada no servidor, independente de o navegador estar aberto.
- Modo “Ao vivo”, com contador da próxima coleta e situação de cada trecho, conforme a seção 9.
- Resultados por dia, filtros essenciais e link para conferir a oferta.
- Alerta ao atingir a meta ou ocorrer queda relevante de preço, com regra explícita para cada modalidade.
- Histórico de tarifas e de notificações, com horário e situação da coleta.
- Interface utilizável em celular.

### Evolução posterior

- Comparação flexível mais ampla, gráficos e melhores combinações de ida/volta.
- Instalação como aplicativo web e notificações push.
- Destinatários específicos por busca, horários silenciosos e resumo diário.
- Painel operacional com falhas, filas, consumo de consultas e custos.
- Planos e cobrança, caso o objetivo seja vender o serviço.

A opção de cidade oculta observada na referência pode ficar fora da primeira versão para reduzir a complexidade de comparação e apresentação dos itinerários.

## 5. Arquitetura sugerida para o novo sistema

Esta seção é uma proposta, não a identificação da tecnologia usada pelo site.

```text
Interface web → API → PostgreSQL
                 ↑
Agendador → fila → trabalhadores de coleta → adaptador do provedor
                           ↓
                 normalização e histórico
                           ↓
                    motor de alertas
                           ↓
                 fila de notificações → WhatsApp / e-mail / Telegram / push
                                             ↓
                                      status de entrega
```

- Interface em React, com foco no fluxo de criação da busca e comparação dos resultados.
- API e coleta em Python se o piloto adotar fast-flights, evitando introduzir outra linguagem no serviço de coleta.
- PostgreSQL para contas, buscas, observações e notificações.
- Fila para coletas e mensagens; Redis pode ser acrescentado conforme concorrência, cache e limites exigirem.
- Adaptador de provedor para trocar a fonte sem reescrever as regras do produto.
- Para WhatsApp, avaliar a plataforma oficial e acompanhar os estados das mensagens por webhook; os [exemplos oficiais da Meta](https://github.com/fbsamples/whatsapp-api-examples) e a [referência de webhooks da Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference) são pontos de partida. Custos e condições devem ser validados na contratação.

Não é necessário usar inteligência artificial para ordenar preços, comparar valores ou decidir os alertas básicos. Essas funções devem ter regras determinísticas e auditáveis.

## 6. Dados e regras essenciais

Entidades propostas: conta, destinatário verificado, busca, aeroportos/datas da busca, execução de coleta, itinerário, observação de tarifa, evento de alerta e tentativa de entrega.

- Salvar valores em centavos, moeda, horário de observação, fonte e escopo do preço: por passageiro, por trecho ou total.
- Identificar itinerários por segmentos, aeroportos e horários; considerar cabine, bagagem e condições tarifárias quando fornecidas.
- Compartilhar coletas equivalentes entre buscas de usuários, preservando os limites de acesso aos dados de cada conta.
- Expandir flexibilidade com datas únicas, evitando consultar várias vezes um mesmo dia.
- Aplicar limites de concorrência, tentativas com espera progressiva e intervalo adaptativo de coleta.
- Deduplicar eventos e envios. Uma repetição técnica de um trabalho não deve produzir uma nova mensagem.
- Definir se a queda compara o mesmo itinerário ou o menor preço da rota/data. Registrar essa referência no evento.
- Após a primeira tarifa dentro da meta, só repetir alerta conforme nova queda relevante ou regra de reentrada; não avisar a cada ciclo com o mesmo preço.
- Guardar estados como pendente, enviado, entregue e falhou conforme a evidência fornecida pelo canal.
- Isolar contas e verificar a posse de destinatários antes de ativar envios.
- Encerrar a busca somente após o fim da última data expandida, considerando o fuso aplicável.

## 7. Capacidade e custo

Um intervalo de cinco minutos gera 288 ciclos por dia. Se cada combinação aeroporto/data exigir uma chamada separada, o volume aproximado é:

```text
chamadas/dia ≈ consultas únicas por ciclo × 288
```

Exemplo ilustrativo: uma origem, dois destinos e três datas de trecho podem representar seis consultas por ciclo, ou 1.728 por dia. Isso depende do suporte do provedor a múltiplos aeroportos e consultas em lote. Cache compartilhado e agrupamento podem reduzir o volume; tentativas após falhas podem aumentá-lo.

Por isso, o intervalo deve ser definido após medir coleta, limites e custos. Copiar a frequência exibida pelo site sem essa medição não é uma boa base para dimensionamento.

## 8. Critérios de aceitação do primeiro piloto

1. Criar uma busca válida e rejeitar datas passadas ou volta anterior à ida.
2. Continuar coletando com o navegador fechado.
3. Mostrar fonte, horário, moeda e escopo de cada preço.
4. Enviar um único alerta quando uma regra for satisfeita, mesmo com repetição de trabalhos.
5. Preservar o último preço válido quando a fonte falhar e sinalizar a falha.
6. Registrar a referência da queda e cada tentativa de entrega.
7. Não permitir acesso de uma conta às buscas de outra.
8. Abrir uma pesquisa externa coerente com o trecho e as datas apresentados.
9. Sincronizar o contador “Ao vivo” com o agendamento real do servidor, inclusive após recarregar a página.
10. Distinguir espera, fila, coleta em andamento, sucesso parcial, falha, pausa e encerramento.
11. Aplicar a referência de preço correta e os modelos de mensagem definidos na seção 10.

## 9. Requisito de desenvolvimento — modo “Ao vivo”

Requisito solicitado pelo usuário em 16/10/2026, inspirado no indicador “Ao vivo” e no contador de coleta do projeto de referência. As regras abaixo especificam o comportamento desejado do novo produto; não descrevem a implementação interna da referência.

### Experiência desejada

Cada busca ativa deve apresentar um indicador/botão “Ao vivo”, com contagem regressiva até a próxima coleta. Ao abrir seus detalhes, mostrar a última consulta bem-sucedida, a próxima execução prevista, o intervalo configurado e o resultado de cada trecho. O botão abre os detalhes do acompanhamento; pausar ou retomar o monitoramento exige um controle explícito e separado.

Exemplo ilustrativo de uma busca em acompanhamento:

```text
● Ao vivo                         Próxima coleta em 00:42
Última atualização: 08:40:12       Intervalo: 1 minuto
THE ↔ GRU / CGH                   Ida 05/11/2026 · Volta 09/11/2026
4 de 4 trechos consultados        [Atualizar agora] [Pausar busca]
```

Os horários do exemplo são ilustrativos. O monitoramento se baseia em consultas periódicas à fonte. O termo “Ao vivo” significa acompanhamento automático ativo; não representa uma conexão que recebe instantaneamente cada alteração de tarifa da companhia aérea.

### Intervalo e execução no servidor

- O intervalo deve ser configurável no servidor. Para o piloto, a proposta inicial é 60 segundos, sujeita à validação de limites, estabilidade e custos. A referência exibia cinco minutos; esse valor não é uma exigência para o novo sistema.
- A coleta continua com a página fechada ou o usuário desconectado. Para isso, um serviço de servidor deve permanecer em execução, com agendador e trabalhadores de coleta.
- O agendador mantém a cadência planejada entre inícios de ciclos. Se uma coleta ultrapassar o intervalo, concluir a execução e usar a próxima oportunidade futura da agenda, sem criar ciclos sobrepostos ou uma sequência para compensar atrasos.
- Antes de cada nova consulta, verificar se a busca está ativa e ainda dentro do período de viagem. Uma execução já em andamento pode finalizar após uma pausa, mas não deve gerar novos alertas depois de a pausa ser registrada.
- No caso do piloto, um ciclo reúne THE → GRU e THE → CGH em 05/11/2026, além de GRU → THE e CGH → THE em 09/11/2026. Cada trecho registra seu próprio sucesso, erro e horário de observação.
- Consultas equivalentes entre buscas podem compartilhar uma execução, respeitando a atualidade dos dados e as regras de cada usuário.

### Contador e estados visíveis

O servidor informa o horário atual e o da próxima execução. O navegador calcula a diferença e atualiza o texto a cada segundo. Recarregar a página, abrir outra aba ou retornar de uma aba em segundo plano não reinicia nem cria uma coleta. A contagem deve ser recalculada a partir dos horários do servidor, compensando a diferença para o relógio do dispositivo.

| Estado | Apresentação esperada |
|---|---|
| Agendada | “Ao vivo · Próxima coleta em 00:42”. |
| Aguardando fila | “Aguardando coleta”, sem contador negativo ou falsa indicação de sucesso. |
| Consultando | “Consultando preços…” e progresso, por exemplo “2 de 4 trechos concluídos”. |
| Ciclo completo | Atualiza os resultados e os horários; mostra a próxima execução prevista. |
| Ciclo parcial | “Atualização parcial · 3 de 4 trechos”; identifica qual trecho falhou e a idade de seu último preço válido. |
| Falha de coleta | “Falha na consulta · Tentando novamente em…”, com horário da próxima tentativa definido no servidor. |
| Sem resposta da fonte | Mantém os últimos valores válidos identificados como antigos; não converte erro em ausência de voos. |
| Painel sem conexão | “Sem conexão com o servidor · Última sincronização…”. Não presume que o serviço de coleta parou nem mantém uma indicação verde de conexão. |
| Pausada | “Busca pausada”; não mostra contagem para uma execução inexistente. |
| Encerrada | “Monitoramento encerrado”; conserva o histórico e informa o motivo. |

Cada tarifa deve conservar seu horário real de observação. Uma tentativa que falhou não atualiza esse horário. Se o ciclo for parcial, não mostrar uma única hora de atualização como se todos os trechos tivessem sido renovados.

O botão “Atualizar agora” solicita uma execução ao servidor, sujeito a limite de frequência e deduplicação. Enquanto já houver um ciclo pendente ou em andamento para a mesma consulta, mostrar esse estado em vez de criar outro trabalho.

### Atualização do painel e disparo de alertas

1. O agendador inicia o ciclo de coleta na fonte.
2. O serviço valida e normaliza os resultados de cada trecho, registrando preço e horário.
3. O motor compara as observações válidas com a referência correspondente e avalia as regras de alerta.
4. O servidor registra os eventos elegíveis e coloca suas notificações na fila de envio.
5. O painel recebe os novos resultados e a próxima execução prevista.
6. Cada canal registra sua tentativa de envio e, quando disponível, a confirmação de entrega.

A atualização do contador não gera chamadas à fonte de tarifas. Como implementação inicial, o painel pode consultar o estado do nosso servidor a cada poucos segundos; posteriormente, eventos enviados pelo servidor podem atualizar a tela. Essa comunicação com o painel não substitui a coleta periódica de tarifas.

Campos mínimos do estado: identificador da busca, situação do monitoramento, horário do servidor, intervalo, próxima execução, última execução iniciada/concluída, última coleta bem-sucedida por trecho, identificador do ciclo, progresso e erro por trecho. Registrar horários com fuso inequívoco e apresentar ao usuário o fuso adotado.

### Aceitação específica

- Duas abas da mesma busca exibem o mesmo agendamento e não multiplicam as consultas.
- Ao zerar o contador, a tela passa a espera/fila/coleta conforme a situação real; não presume preços atualizados.
- Após recarregar a página, a contagem continua a partir da agenda do servidor.
- Uma falha em CGH não impede a publicação de resultados válidos de GRU, mas o ciclo aparece como parcial.
- Pausar interrompe novos agendamentos e novos alertas da busca; retomar agenda uma consulta sem duplicar uma execução existente.
- Fechar o navegador não interrompe a coleta nem o envio de alertas no serviço permanente.

## 10. Requisito de desenvolvimento — alertas de preço

Referência adicional: captura de WhatsApp fornecida pelo usuário em 16/10/2026. A imagem mostra notificações individuais e uma mensagem com blocos de ida e volta. Os exemplos da captura usam ida em 06/11; o piloto solicitado usa ida em 05/11. Os dois casos não devem ser confundidos.

### Conteúdo observado e desejado

Cada bloco de alerta deve incluir:

- Companhia e motivo do aviso.
- Direção da viagem: IDA ou VOLTA.
- Data da viagem e horário de saída.
- Aeroportos de origem e destino.
- Preço anterior e novo preço, em reais.
- Economia em valor absoluto e percentual.
- Link para conferir a passagem/pesquisa externa.

No novo produto, acrescentar o nome da busca quando definido, o horário da coleta, a base de comparação e a indicação “por adulto / trecho”. Na captura, o horário ao lado da mensagem pertence à conversa; ele não comprova o horário em que a tarifa foi coletada.

### Referência de comparação

A sequência da captura alterna companhia e aeroporto entre alertas. Por isso, ela não permite concluir que todos representam redução de preço de um mesmo voo. O sistema deve suportar e identificar dois tipos de acompanhamento:

| Tipo | Comparação | Mensagem |
|---|---|---|
| Mesmo itinerário | Mesmos segmentos, aeroportos, datas, horários, companhia e condições tarifárias comparáveis. | “PREÇO CAIU”. |
| Melhor opção da busca | Menor tarifa elegível para uma direção/data entre os aeroportos e filtros selecionados; pode mudar companhia, voo ou aeroporto. | “NOVA MENOR TARIFA”, informando se mudou o voo ou aeroporto. |
| Meta de orçamento | Uma tarifa elegível atinge ou fica abaixo do limite configurado. Pode ocorrer já na primeira coleta. | “META ATINGIDA”; não inventa preço anterior ou economia sem histórico válido. |

Para reproduzir a experiência geral da referência, adotar inicialmente “Melhor opção da busca”, separando a referência por direção e data. Em uma busca com vários dias, não comparar a tarifa de um dia com a de outro sem identificar explicitamente a comparação de datas flexíveis. Oferecer o acompanhamento de um itinerário específico como configuração adicional.

O “preço anterior” de uma queda deve ser a última observação válida da mesma referência de comparação antes da nova coleta. Guardar também o último valor alertado para evitar repetir a mesma oportunidade. O cadastro de uma busca sem histórico apenas cria a referência inicial, salvo regra de meta já atingida.

Não comparar amostras com escopos diferentes como se fossem uma queda real. Mudanças de fonte, parser, moeda, quantidade de passageiros, bagagem ou filtros devem reinicializar a referência afetada ou exigir uma normalização comprovada. No piloto realizado, a adaptação do leitor passou a incluir um grupo de resultados antes ignorado: essa diferença de cobertura, por si só, não deve disparar um alerta de queda de mercado.

### Cálculo e apresentação

```text
economia = preço_anterior − preço_atual
economia_percentual = 100 × economia / preço_anterior
```

Calcular com preços em centavos, mantendo a mesma moeda e o mesmo escopo de passageiros/trecho. Só calcular percentual quando houver preço anterior válido maior que zero. O percentual pode ser arredondado ao inteiro mais próximo para reproduzir a apresentação da captura. O histórico mantém os valores exatos.

Exemplo de conteúdo baseado em uma das mensagens fornecidas, sem representar uma tarifa atual ou um alerta enviado pelo nosso sistema:

```text
Azul — PREÇO CAIU

IDA · 06/11/2026 · 20:30
THE → GRU
R$ 1.165 → R$ 993
Economia: R$ 172 (15%)
Preço por adulto / trecho

Comparação: mesmo itinerário e condições tarifárias
Coletado em: [data e horário da coleta]
Conferir no Google Voos: [link da pesquisa]
```

O exemplo usa o título de redução no mesmo itinerário apenas para ilustrar o modelo. A captura, isoladamente, não comprova equivalência das condições tarifárias; o nosso serviço precisa validá-la antes de emitir esse título. Se trocar o voo, usar “NOVA MENOR TARIFA” e registrar a mudança.

### Agrupamento, canais e entrega

- Se ida e volta gerarem eventos elegíveis no mesmo ciclo para a mesma busca e destinatário, permitir uma mensagem única com um bloco por direção, como na captura. Cada bloco conserva sua referência e sua economia; o agrupamento não transforma os trechos em uma oferta conjunta de ida e volta.
- Se apenas um trecho apresentar queda elegível, enviar apenas esse bloco. Não aguardar indefinidamente um resultado ou evento da outra direção.
- Renderizar o mesmo evento em WhatsApp, e-mail, Telegram ou notificação no aplicativo, adaptando títulos, botões e formatação às capacidades de cada canal.
- No WhatsApp, avaliar modelos aprovados para o envio pelo canal oficial; o visual da captura não identifica a integração usada pela referência nem comprova a aprovação de um modelo.
- Aplicar valor mínimo de queda, percentual mínimo ou preço-alvo conforme a regra escolhida pelo usuário, com combinação explícita entre condições.
- Controlar frequência e deduplicação por busca, referência comparada, observação/evento, destinatário e canal. Uma nova tentativa técnica de envio não deve criar outro evento.
- Não repetir a mesma oportunidade quando o preço oscilar e retornar ao valor já notificado dentro do intervalo de silêncio configurado; uma nova queda elegível pode gerar outro alerta.
- Guardar preço de referência, preço novo, economia, identificadores dos itinerários, horário da coleta, motivo, canal, destinatário e tentativas de entrega.
- Diferenciar “na fila”, “enviado”, “entregue” e “falhou” conforme a confirmação efetivamente disponível no provedor.

### Aceitação específica

- R$ 1.165 → R$ 993 produz economia de R$ 172 e percentual exibido de 15%.
- Preço inalterado ou coleta repetida não gera outro evento.
- Uma primeira observação sem histórico não mostra economia inventada.
- Mudança de companhia, aeroporto ou itinerário aparece na mensagem quando a referência é o menor preço da busca.
- Ida e volta do mesmo ciclo podem compor uma única mensagem, com duas economias independentes.
- Mudança da cobertura do leitor, como a correção identificada no piloto, não é apresentada automaticamente como redução de tarifa.
- Uma falha na coleta ou no canal é registrada e não gera confirmação de entrega fictícia.

## 11. Requisito de desenvolvimento — filtros e múltiplos aeroportos

Ampliação solicitada pelo usuário em 16/10/2026: múltiplos aeroportos nos dois lados da viagem, janela de partida atravessando a meia-noite, limite de duração e quantidade de escalas. A versão 2 do mockup mantém o visual claro, sem neon, e representa esses recursos. É uma proposta visual, não uma implementação da busca ou de todos os filtros na fonte atual.

### Pesquisa de referências

Foram consultadas fontes oficiais em 16/10/2026:

- [Google Voos — busca e aeroportos alternativos](https://support.google.com/travel/answer/2475306?hl=pt-BR): comparação de aeroportos/datas e ofertas de bilhetes separados.
- [Google Voos — melhores preços](https://support.google.com/travel/answer/7664728?hl=en): distinção entre menor preço e conveniência, considerando duração, escalas e mudanças de aeroporto.
- [KAYAK — busca e filtros](https://www.kayak.co.uk/news/what-is-kayak-flight-search/): horários, aeroportos, companhias, ordenação, passageiros, cabine e bagagem.
- [KAYAK — conexões](https://www.kayak.co.uk/news/what-is-a-layover/): seleção de voos sem escalas, uma escala ou duas ou mais.
- [Skyscanner — filtro de conexões](https://www.skyscanner.net/news/control-where-you-connect-with-the-layovers-filter): aeroportos de conexão e duração máxima da espera.

A janela contínua com data e hora abaixo é a solução proposta para a necessidade do usuário; as referências consultadas não comprovam que seus filtros implementem exatamente a mesma regra.

### Aeroportos de origem e destino

- Os dois campos aceitam cidade ou aeroporto e seleção múltipla por etiquetas removíveis.
- A escolha por cidade deve revelar quais aeroportos serão incluídos. “São Paulo” não deve adicionar aeroportos silenciosamente: o exemplo seleciona explicitamente GRU e CGH; VCP só entra se selecionado.
- O seletor mostra cidade, nome do aeroporto e código IATA. Aeroportos repetidos são removidos antes de gerar as combinações.
- Avaliar todas as combinações válidas das origens com os destinos e ordenar os resultados elegíveis por preço. Agrupar por cidade não apaga a identidade do aeroporto de cada oferta.
- Exemplo: origens THE e SLZ, destinos GRU e CGH resultam em quatro pares por data/direção. Seleções múltiplas são alternativas da mesma busca, não uma sequência de viagem multicidades.
- “Incluir aeroportos próximos” é opcional e exige mostrar os aeroportos candidatos antes de incorporá-los à seleção.
- Ida e volta aceitam configurações independentes. Ao configurar ida/volta, oferecer inversão inicial dos conjuntos de aeroportos, permitindo ajuste posterior.
- Oferecer a preferência “Voltar pelo mesmo aeroporto de chegada”. Se desativada, destacar combinações que chegam em GRU e saem de CGH, sem presumir traslado incluído.
- Não permitir pares com origem igual ao destino. Mostrar o número de combinações e aplicar limites de quantidade/datas conforme capacidade validada.

### Janela de partida com data e hora

Apresentar duas formas claras de seleção de datas: “Datas e horários livres” e “Janela de saída”. O modo de janela evita interpretar uma faixa noturna como se fosse um intervalo de horas dentro de um único dia.

Exemplo solicitado:

```text
IDA · JANELA DE SAÍDA
A partir de: 05/11/2026 às 22:00
Até:         06/11/2026 às 06:00
Horário local de cada aeroporto de origem
```

Regras:

1. A janela vale para a partida do primeiro segmento do itinerário, incluindo os limites escolhidos. No exemplo, entram partidas às 22:00 do dia 5 até 06:00 do dia 6; não entram 21:59 do dia 5 ou 06:01 do dia 6.
2. A volta tem outra configuração e não herda automaticamente o horário da ida. Mostrar abas “Ida” e “Volta” na edição de horários.
3. Uma janela que atravessa a meia-noite exige consultas às duas datas. Se a fonte filtrar apenas por dia ou hora inteira, coletar uma cobertura suficiente e aplicar a validação exata de data/hora no servidor.
4. Mostrar a data ao lado de cada horário de partida/chegada no resultado. Não apresentar 02:35 do dia 6 como se fosse do dia 5.
5. Datas e horas de partida seguem o fuso local de cada origem; as de chegada seguem o destino correspondente. Se os aeroportos selecionados tiverem fusos distintos, explicitar essa regra na configuração. Armazenar identificadores de fuso e instantes UTC quando disponíveis.
6. “Chegar até” é um filtro separado, sobre a chegada do último segmento. Ele não se confunde com o fim da janela de saída.
7. Validar início anterior ao fim e impedir intervalos já encerrados. Uma chegada pode ocorrer fora da janela de partida, salvo restrição explícita de chegada.
8. Para várias datas flexíveis, não combinar silenciosamente uma janela absoluta com uma faixa diária recorrente. A recorrência diária pode ser uma evolução com configuração e resumo próprios.

### Duração, escalas e conexões

São três filtros independentes:

| Filtro | Significado | Controle proposto |
|---|---|---|
| Quantidade de escalas | Categorias admitidas no itinerário. | Seleção múltipla: “Sem escalas”, “1 escala”, “2 ou mais”. |
| Duração total | Tempo decorrido entre a primeira partida e a chegada final, incluindo espera em conexões. | Limite em horas e minutos; slider com entrada numérica acessível. |
| Tempo de conexão | Espera entre segmentos, em cada conexão. | Duração mínima/máxima e seleção dos aeroportos permitidos/excluídos. |

Selecionar “Sem escalas” e “1 escala” significa aceitar até uma escala. Selecionar apenas “1 escala” exclui voos sem escalas. Selecionar somente “2 ou mais” não significa “no máximo duas”. Todas as categorias selecionadas equivalem a não restringir esse critério. Impedir salvar sem nenhuma categoria, ou explicar o estado vazio enquanto o usuário edita.

O rótulo “Sem escalas” representa ausência de paradas intermediárias. Não inferir isso somente da ausência de troca de aeronave quando a fonte indicar parada técnica; seguir os metadados disponíveis e explicitar eventual informação desconhecida.

A duração total deve ser calculada em instantes UTC ou obtida de um campo confiável do provedor. Subtrair relógios locais sem considerar fusos pode gerar duração incorreta. Restrições de tempo de conexão não se aplicam a voos sem conexão.

No modo avançado, oferecer “Evitar troca de aeroporto durante a conexão”, “Evitar autotransferência/bilhetes independentes dentro do trecho” e “Evitar pernoite em conexão”, quando a fonte permitir verificar essas condições. A restrição de troca de aeroporto durante uma conexão é diferente da preferência por retornar pelo mesmo aeroporto de chegada no destino da viagem.

### Organização dos demais filtros

| Grupo | Opções propostas | Prioridade |
|---|---|---|
| Trajeto e datas | Múltiplos aeroportos, ida/volta, datas flexíveis e janela de saída. | Essencial. |
| Horários e duração | Janela de partida, chegada até uma data/hora, escalas e duração total máxima. | Essencial. |
| Preço e alertas | Preço máximo para resultados, preço-alvo para notificação, queda mínima e moeda. | Essencial; manter preço máximo e meta como conceitos distintos. |
| Companhias | Permitir/excluir companhias; identificar companhia comercial e operadora quando disponíveis. | Avançado. |
| Conexões | Aeroportos, espera mínima/máxima, pernoite, troca de aeroporto e autotransferência. | Avançado e condicionado aos dados. |
| Passageiros e cabine | Adultos, crianças, bebês e cabine, com validações e preço do grupo. | Expandir além do piloto de um adulto. |
| Bagagem | Item pessoal, mala de cabine, quantidade de malas despachadas e preço comparável com bagagem. | Condicionado à fonte e confirmação de condições. |
| Condições tarifárias | Alteração, cancelamento, reembolso e seleção de assento. | Evolução, apenas com dados verificáveis. |
| Ordenação | Menor preço, menor duração, saída mais cedo e chegada mais cedo. | Essencial. “Melhor opção” só com critérios explicáveis. |

Campos indisponíveis na fonte não podem aparecer como garantias aplicadas. Se não for possível verificar uma condição, informar a limitação e impedir a promessa de alerta filtrado por ela. Emissões, comodidades e exclusão de aeronaves podem ser avaliadas depois, sem sobrecarregar a primeira versão.

### Filtros salvos e aplicação aos alertas

- Separar exploração de resultados de alteração permanente da busca. O botão “Salvar filtros da busca” explicita que os critérios passam a valer para as próximas coletas e alertas.
- Um filtro meramente visual não altera alertas sem essa ação. Ordenação da lista, isoladamente, não altera os critérios do monitoramento.
- Salvar uma versão dos critérios e associá-la às coletas, referências de preço e eventos de alerta. Ao mudar o conjunto de voos elegíveis, reinicializar as referências afetadas para não gerar uma queda artificial.
- Aplicar critérios de elegibilidade antes de calcular o menor preço, a economia e a meta atingida. Não avisar sobre uma oferta de 15 horas se a duração máxima salva for 8 horas.
- No modo “Melhor opção da busca”, comparar todas as combinações elegíveis dos aeroportos para a mesma direção/janela, distinguindo novas datas/voos quando mudarem. Em uma janela que atravessa a meia-noite, as duas datas integram a mesma referência de janela; em datas avulsas, manter referências por data.
- Se não houver opção elegível, mostrar “Nenhum voo corresponde aos filtros” e permitir revisar os critérios; não relaxá-los silenciosamente. Falha ou cobertura incompleta da coleta deve continuar diferenciada de resultado vazio.
- No histórico e na mensagem, registrar o aeroporto e a data/hora efetivos da opção encontrada, mesmo quando a busca agrupa vários aeroportos.

### Layout do mockup v2

- Desktop: resumo de trajeto com etiquetas de aeroportos, painel lateral de filtros, janela de saída expandida, escalas e duração visíveis; os demais grupos ficam em seções recolhíveis. Os resultados continuam em cartões com data, aeroporto, duração e preço claros.
- Celular/tablet estreito: botão “Filtros”, contador de critérios ativos e resumo da janela. A edição abre um painel de tela inteira com cabeçalho fixo, conteúdo rolável e botão de salvar acessível no rodapé. O mockup mostra esse estado de edição no celular.
- Manter a direção visual aprovada: fundo claro, azul sóbrio, verde discreto, foco visível e espaçamento para toque. Os filtros também devem ter campos operáveis por teclado, sem depender exclusivamente de sliders.
- Todos os voos, valores, horários e contagens da imagem v2 são ilustrativos. A demonstração visual não comprova disponibilidade nem suporte de cada recurso no coletor atual.

### Critérios de aceitação

1. Selecionar THE/SLZ → GRU/CGH produz quatro pares válidos por data antes de deduplicação/compartilhamento de coletas.
2. Na janela 05/11/2026 22:00–06/11/2026 06:00, incluir 05/11 22:00, 06/11 00:15 e 06/11 06:00; excluir 05/11 21:59 e 06/11 06:01.
3. Não reaproveitar o voo de 05/11 às 02:35 dentro dessa janela; um voo de 06/11 às 02:35 pode ser elegível.
4. Uma opção que parte dentro da janela e chega depois das 06:00 continua elegível se não existir limite de chegada e sua duração respeitar o máximo.
5. “Apenas 1 escala” exclui voos sem escalas e com duas ou mais. O limite de duração é aplicado independentemente dessa seleção.
6. Duração máxima de 8h inclui 8h e exclui 8h01, levando em conta o tempo de conexão.
7. Uma tarifa fora dos filtros salvos não pode disparar um alerta, mesmo sendo a menor tarifa bruta da fonte.
8. Informações desconhecidas sobre bagagem ou conexão não são apresentadas como condições confirmadas.
9. Alterar filtros inicia uma referência de comparação compatível com a nova versão, preservando o histórico anterior.

## Próxima etapa recomendada

Validar a fonte de tarifas em poucas rotas reais e definir se o uso será pessoal ou um serviço para vários clientes. Com essa evidência, implementar o fluxo completo de uma busca, da coleta ao alerta, e então expandir filtros e apresentação.


## Primeira revisão implementada — versão 0.2 (16/10/2026)

- Catálogo mundial: 7.884 aeroportos com IATA, consulta por código/cidade/nome, até três origens e três destinos. As combinações seguem os limites operacionais do piloto. Código no catálogo não garante oferta na fonte.
- Cadastro em três etapas: **Viagem → Preferências → Alertas**. Na primeira, ficam trajeto, tipo de viagem, adultos e janela; nome/cabine são recolhidos. Na segunda, escalas/duração/bagagem; chegada, conexões e companhias ficam nas opções avançadas. Na última, meta, queda mínima, intervalo de coleta e e-mail.
- Janelas locais de saída com dois seletores na barra e campos de data/hora; a data final permite atravessar a meia-noite. Duração, espera máxima e intervalo de coleta aceitam barra e digitação. A coleta permite minutos inteiros de 1 a 30.
- Texto secundário mais escuro, tipografia ampliada, campos de 16 px no celular e controles principais de pelo menos 44 px. Cartões móveis distribuem horário, preço e ação em linhas distintas.
- Bagagem despachada: opção de solicitar a inclusão de taxas estimadas para uma ou duas malas na pesquisa. Zero não afirma tarifa sem bagagem. Franquia, peso e dimensões continuam sujeitos à confirmação na companhia. A fonte não oferece comprovação da franquia pelo parser atual.
- Códigos de companhias internacionais aceitos nos filtros avançados (IATA de dois caracteres); todos são aceitos quando o filtro fica vazio.
- Acesso opcional pela rede privada 192.168.3.0/24 para validação em celulares/tablets, com a mesma sessão de desenvolvimento. Nenhuma publicação no GitHub ou na Internet.

Referências verificadas nesta revisão: [fast-flights 3.1.0](https://pypi.org/project/fast-flights/3.1.0/), [filtro de taxas de bagagem do Google Voos](https://support.google.com/travel/answer/9074247?hl=pt-BR) e [catálogo airportsdata](https://pypi.org/project/airportsdata/).


## Cadastro e administração implementados — revisão 0.3

- Cadastro com nome, país/bandeira/DDI, telefone com código de área e senha. Login por telefone normalizado; verificação por código ainda não integrada.
- Perfil com até quatro e-mails e preferência de WhatsApp usando o telefone do cadastro ou outro número internacional.
- Separação real por conta na API e no SQLite: buscas, resultados, alertas e exportações privados por proprietário.
- SMTP exclusivo da área administrativa. O usuário apenas informa seus contatos; o e-mail de teste do administrador não recebe alertas de outras contas.
- Administrador inicial criado no próprio Mac, sem senha padrão. Buscas legadas preservadas e vinculadas à conta administrativa.
- Envio por WhatsApp/Telegram continua pendente de provedor e integração, sem simulação de entrega.
