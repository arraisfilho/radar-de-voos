# Arquitetura da versão local

## Componentes

O frontend React/TypeScript é compilado pelo Vite e servido pela mesma API FastAPI. Tailwind CSS e estilos próprios implementam o visual aprovado; Radix Dialog fornece foco e navegação do editor modal; Radix Slider oferece seletores acessíveis por teclado e toque. O cadastro usa três etapas, com opções avançadas recolhidas. TanStack Query atualiza o estado do painel a cada três segundos. Esse intervalo não dispara consultas no Google Flights.

Um único agendador percorre buscas devidas. Cada ciclo gera combinações únicas de direção, aeroportos e data, com até dois subprocessos de coleta simultâneos. Cada subprocesso tem timeout de 35 segundos. Uma janela noturna produz consultas a ambas as datas. Não há captura contínua de eventos da companhia.

O adaptador busca a resposta uma vez e reaproveita o parser fast-flights para os grupos 2 e 3. A identidade inclui companhias e segmentos com aeroportos/datas/horários. Preços duplicados da mesma identidade são reduzidos ao menor retornado. O formato do provedor é uma dependência frágil: mudanças devem ser verificadas e versionadas.

Os filtros são aplicados no servidor a todos os resultados retornados; não é feito apenas um filtro visual sobre cinco voos. Ainda assim, a fonte pode não fornecer todos os voos elegíveis existentes.

## Persistência e ciclo de vida

SQLite usa WAL e transações curtas. Há buscas, ciclos, resultados por rota, snapshots de menor preço, referências de comparação, alertas e fila SMTP. Busca e configuração possuem uma versão. Um resultado de versão antiga não substitui preços nem produz alertas da nova versão.

Uma coleta incompleta conserva a última resposta válida de cada rota na interface, sinalizada como antiga. Não produz alertas de uma direção enquanto alguma consulta daquela direção tiver falhado. Respostas vazias interpretáveis são distinguíveis de falhas, mas não garantem ausência absoluta de voos.

O agendador planeja uma próxima oportunidade futura da cadência e evita sobreposição do mesmo serviço. O intervalo configurado é respeitado após falhas: não há multiplicação silenciosa da espera. Ciclos mais longos que o intervalo pulam horários já ultrapassados, sem acumular trabalhos ou sobrepor coletas. Um reinício recupera ciclos interrompidos e volta a agendar buscas ativas. O processo foi desenhado para uma única instância; múltiplos servidores exigirão locks distribuídos, fila externa e banco adequado.

Arquivar é reversível pela área de configurações; os dados anteriores são conservados. A restauração deixa a busca pausada para revisão de datas. Não foi implementada remoção definitiva.

## Eventos e envio

O motor avalia orçamento e queda mínima, registra a referência e deduplica eventos. Meta já atendida na primeira coleta é um motivo próprio, sem economia anterior. Alertas comparáveis dependem da mesma versão de filtros e do adaptador; modificações nessa cobertura exigem uma nova referência.

Eventos de ida e volta da mesma busca/ciclo podem compor uma mensagem. SMTP só é acionado quando configurado e quando a busca permite e-mail. O transporte usa TLS validado, não registra senha e não devolve erros brutos do servidor. Falhas de entrega são mantidas para inspeção; não há retentativa automática quando o resultado do transporte pode ser ambíguo. Uma falha de QUIT depois de aceitação não transforma o envio em tentativa falha.

Não se confunde envio ao SMTP com entrega na caixa de entrada. Uma futura integração de eventos do provedor poderá acrescentar rejeições e entregas confirmadas.

## Preparação para GitHub

Fonte e lockfiles entram no repositório. Dados, senhas, ambientes e builds não entram. A instalação é reproduzível pelos comandos do README e possui verificações locais e workflow futuro. A visibilidade privada será definida ao criar o remoto, apenas mediante autorização posterior. Git local não determina a visibilidade de um futuro repositório no GitHub.

Antes de hospedagem compartilhada serão necessários autenticação, isolamento de usuários, armazenamento apropriado de segredos, agendamento supervisionado, backups e validação de capacidade/termos da fonte. Esses itens não foram apresentados como implementados nesta entrega.


## Revisão 0.2: catálogo, bagagem e rede

`backend/airports.py` carrega o catálogo IATA da dependência `airportsdata==20260905` (MIT). A busca normaliza acentos e algumas traduções de cidades; códigos exatos e cidades são priorizados sobre nomes de regiões. `GET /api/airports?q=` retorna até 20 sugestões. O polling de estado inclui somente metadados dos aeroportos salvos, evitando transferir o catálogo completo a cada três segundos. Fusos IANA do catálogo são usados nos cálculos de duração e conexão.

`Search.checked_bags` aceita 0, 1 ou 2 e chega até `create_query(checked_bags=...)` e ao link de pesquisa. Zero significa não adicionar taxas ao cálculo, sem afirmar ausência de bagagem na tarifa. O retorno registra a quantidade solicitada e mantém a franquia como desconhecida. Alterações de critérios criam uma nova versão; o identificador do adaptador foi atualizado para evitar comparar referências antigas com nova semântica de preço. Configurações antigas recebem o valor padrão sem perder os demais critérios.

`RADAR_HOST=0.0.0.0` só é aceito com `RADAR_LAN_CIDR` explicitamente configurado como uma rede IPv4 privada /24 ou menor. O middleware rejeita clientes fora de loopback/sub-rede, nomes de host não autorizados e alterações sem token ou com outra origem. O modo LAN é para validação numa rede confiável; contas e autorização foram adicionadas na revisão 0.3, conforme o documento ACCOUNTS.md.


## Refinamento para uso simples

A escolha de um aeroporto encerra o campo; adicionar uma alternativa exige clicar em “Adicionar outra origem/outro destino”. No cadastro inicial, selecionar origem leva ao destino e selecionar destino leva ao próximo campo. Alertas externos começam desativados em novas buscas; ao ativar “Enviar alertas”, aparece a escolha de canal. Somente e-mail está integrado; WhatsApp/Telegram ficam indisponíveis e identificados como “Em breve”. Não são simulados envios nesses canais.

Falhas de consulta não produzem mensagens técnicas na página principal. Preços reaproveitados seguem identificados como atualização pendente; detalhes por rota ficam recolhidos em “Ao vivo → Detalhes técnicos”. “Buscar agora” é explícito no painel e no acompanhamento, respeitando uma consulta em andamento e o limite de 30 segundos entre solicitações.

O adaptador ignora itinerários individuais não verificáveis (por exemplo, troca de aeroporto em conexão ou código ausente do catálogo), preservando outras ofertas válidas da consulta. Quantidades descartadas ficam nos metadados de diagnóstico. Se todas as ofertas forem não verificáveis, o resultado continua sendo erro, sem se tornar uma falsa resposta vazia.


## Revisão 0.3: identidade e autorização

`backend/accounts.py` implementa normalização internacional de telefone, validação de até quatro e-mails, hash de senha Argon2id e sessões revogáveis. SQLite recebe tabelas accounts/sessions/login_attempts, owner_id nas buscas e recipients na fila. A identidade da conta vem da sessão; não é aceita do corpo da busca. Todos os caminhos de leitura, edição, arquivamento, restauração e exportação conferem o proprietário. A criação inicial de administrador só é permitida por loopback, com índice que impede dois administradores iniciais. Requisições comuns de cadastro ignoram qualquer papel fornecido pelo cliente.

SMTP aparece no estado somente para administradores e suas rotas de alteração/teste validam o papel no servidor. O e-mail de teste permanece na configuração administrativa; os e-mails de alertas vêm do perfil do proprietário e são registrados por mensagem. A troca dos e-mails do perfil cancela mensagens ainda pendentes para os contatos antigos. Mensagens já em trânsito não podem ser retiradas. Filas antigas sem destinatário por conta são canceladas na migração, sem envio global por compatibilidade.

O frontend oferece cadastro/login, Meu perfil e Administração. Países/DDIs são oferecidos pelo catálogo libphonenumber-js, enquanto phonenumbers valida o número no backend. A escolha de telefone alternativo para WhatsApp fica persistida, mas não habilita um transporte ainda não integrado. Nenhuma confirmação de posse do número ou de e-mail é presumida.


## Revisão 0.4: autorização Google

`backend/google_mail.py` implementa OAuth web com PKCE e escopo de envio da API Gmail. O token de renovação fica no diretório privado, modo 0600; o estado OAuth de dez minutos é vinculado à sessão/admin e consumido uma única vez no callback. O navegador recebe apenas a URL de autorização e o estado público da conta. Callback não depende do cookie SameSite em um retorno de outro site; verifica a sessão vinculada no servidor.

O envio usa MIME/base64url na API Gmail. A fila preserva destinatários por conta e sua política de não repetir resultados ambíguos. O teste administrativo Google vai para a própria conta conectada; o destinatário SMTP de teste não interfere. Configuração/autorizações são exclusivas do administrador. O callback deste ambiente usa loopback no Mac. Ver GOOGLE_MAIL.md para configuração e limites.


## Refinamento 0.4.1: descoberta de provedor

`mail_discovery.py` normaliza o e-mail e identifica Gmail diretamente ou Google Workspace pelo MX, com timeout de quatro segundos. POST /api/mail/connect prepara o fluxo OAuth com login_hint para Google, preservando estado/PKCE/sessão. A tela de adicionar conta contém somente e-mail e Continuar; a configuração OAuth do aplicativo fica separada e recolhida. Provedor não identificado permite seleção explícita ou configuração manual, sem derivar servidor de envio dos MX de entrada.


## Revisão 0.5: distribuição local com cliente público

A interface não oferece campos Client ID/Secret. O mantenedor prepara `config/google-oauth-public.json` com um cliente Desktop público uma vez por distribuição. O script de preparação descarta segredos e rejeita credenciais Web. O manifesto recebeu o Client ID real em 16/10/2026. O projeto Google permanece Interno (Workspace); a autorização interativa e o envio ainda não foram validados.

Desktop usa PKCE e retorno `http://127.0.0.1:8765/`; a rota raiz encaminha respostas OAuth ao callback com Cache-Control no-store. Tokens ficam no diretório privado por instalação, nunca no manifesto. Alterar o cliente distribuído invalida a conexão efetiva e exige reconectar, sem herdar segredo Web ou usar SMTP silenciosamente. A credencial privada de um cliente Desktop com mesmo tipo/ID é preservada; o teste de protocolo real mostrou que o Google a exige na troca de autorização. O fluxo local precisa ser iniciado no computador servidor. Hospedagem remota exige uma integração web própria.
