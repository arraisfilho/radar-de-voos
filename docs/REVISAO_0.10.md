# Revisão 0.10 — início, histórico da conta e atualizações condicionais

## Página inicial e navegação

Após o login, a página inicial apresenta um convite para criar o primeiro monitoramento, caso não haja buscas em acompanhamento. Havendo buscas ativas ou pausadas, apresenta cartões com nome, rota, datas, situação e últimos preços observados por direção. Os preços são históricos observados, não confirmação de disponibilidade atual. Somente ida não apresenta preço de retorno.

Clicar em um cartão abre os voos daquela busca. A lateral continua permitindo alternar diretamente entre monitoramentos, e Nova busca permanece no topo e na lateral. Criar uma busca abre seus detalhes. A primeira opção geral de navegação passa a ser Página inicial; ela substitui a entrada genérica Minhas buscas, mantendo a lista lateral de buscas individuais.

## Histórico e avisos

O seletor de monitoramento agrupa Em acompanhamento e Encerradas, com rota no nome da opção. Os controles recebem alvos de toque maiores, foco visível e contraste consistente. Trechos no gráfico usam botões segmentados e as versões são identificadas como Filtros usados. A troca de monitoramento reinicia os controles do gráfico. Sem buscas ativas, o histórico abre uma busca encerrada existente; sem registros, convida a criar uma viagem.

A página Alertas deixa de depender da busca selecionada. Mostra avisos de todas as buscas pertencentes à conta, incluindo as encerradas, com viagem, data, trecho, preço anterior/atual e situação do envio. Há filtros por viagem e situação, paginação de trinta registros e totais de avisos enviados, pendentes e que exigem atenção. Totais contam avisos/oportunidades, não quantidade de mensagens: uma mensagem pode reunir ida e volta.

E-mail enviado significa aceito pelo provedor, sem comprovar chegada à caixa de entrada ou leitura. Pendentes representa avisos efetivamente na fila. Ausência de destinatário ou de serviço de envio é sinalizada separadamente e não representa envio automaticamente agendado.

A aba Variações de preço mostra altas e quedas do menor preço elegível de cada direção/versão, a partir das coletas completas. Não mistura essas observações com mensagens enviadas. O voo ou companhia pode mudar entre os menores preços. Uma alta não cria um alerta de oportunidade por e-mail; o comportamento de envio continua obedecendo às metas/quedas e preferências salvas. Não foram criados avisos fictícios para preencher a tela.

Encerrar uma busca preserva os avisos. Excluir definitivamente uma busca mantém o contrato anterior: remove seus dados relacionados após confirmação. O histórico de contas diferentes permanece isolado.

## Perfil

Identidade, telefone de acesso e saída da conta ficam reunidos no topo. O formulário conserva nome e e-mails primários; WhatsApp/Telegram, silêncio e auditoria ficam em grupos expansíveis. Foi removido o cartão apenas informativo Seus alertas e o telefone de acesso repetido. Contatos alternativos e até quatro e-mails continuam disponíveis. WhatsApp e Telegram continuam sendo contatos para futuras integrações, sem envio ativo por esses canais.

## Atualizações e recursos

O SQLite mantém revisões por conta, atualizadas por gatilhos em buscas, coletas, preços, alertas, entregas e perfil. O cliente envia a revisão conhecida no polling. Quando nada mudou, a API responde somente com indicação de conteúdo inalterado, revisão e horário do servidor; não decodifica nem retransmite a lista de voos/histórico. Alterações de outra conta não invalidam a revisão deste usuário.

Quando há mudança, é transmitido o estado da área solicitada; não se trata ainda de um patch campo a campo. Página inicial, alertas, perfil e administração não carregam voos. Somente administração recebe configurações do serviço de envio. Histórico e ciclos continuam sendo carregados conforme a área. O endpoint padrão continua compatível com o contrato anterior, e autenticação é verificada antes de qualquer resposta condicional.

A lista de voos informa o vencimento da próxima partida exibida. O cliente deixa de reutilizar a revisão ao alcançar esse instante, mesmo sem mudança no banco, para reavaliar partidas passadas. O cálculo usa horário do servidor e instante de recepção, sem depender de o relógio do dispositivo coincidir com o do servidor.

## Retenção conservadora

`RADAR_RAW_RETENTION_DAYS` define o prazo das respostas brutas, com padrão de trinta dias e faixa de sete a 3650. Uma manutenção por hora exclui no máximo dois mil resultados brutos antigos e redundantes por execução. Preserva sempre a última tentativa e a última resposta válida de cada combinação de busca, versão e rota, inclusive quando mais antigas, para manter a recuperação de preços após falhas.

Preços/snapshots, referências, alertas e entregas não são removidos por essa rotina. Ciclos antigos só são removidos se estiverem sem referências, fora dos trinta últimos ciclos da busca e não estiverem em andamento. A retenção não executa VACUUM nem interrompe o monitoramento para compactar o arquivo. O espaço liberado internamente pode ser reutilizado pelo SQLite; o tamanho do arquivo não necessariamente diminui de imediato. Backups privados anteriores às atualizações permanecem fora do repositório.

## Validação e próximos passos

Testes cobrem home sem buscas/com múltiplas buscas, resumo de somente ida, isolamento entre contas, revisões e respostas enxutas, mudanças de status/perfil/exclusão, histórico paginado de avisos de buscas encerradas, altas/quedas sem notificações inventadas e retenção sem perda de snapshots, alertas ou respostas de recuperação. Os testes de interface usam componentes isolados e dados fictícios; não acessam a sessão do navegador.

A inspeção visual de desktop, celular e zoom continua pendente pelo bloqueio de origem já identificado na ferramenta do navegador. A compilação e testes de lógica não substituem essa conferência. Nenhum caminho alternativo foi usado para contornar a política.

Próximas melhorias recomendadas: marcar avisos como lidos, preferências de notificação por busca mais visíveis, verificação de posse dos contatos e testes visuais/acessíveis nos dispositivos. Atualizações por seção ou eventos podem ser avaliadas com medições quando o número de contas crescer. Nada foi publicado ou enviado ao GitHub.
