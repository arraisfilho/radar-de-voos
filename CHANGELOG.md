# Alterações

## 0.32.3

### Fixed
- Excluir uma viagem com muito histórico deixou de falhar com "database or disk is full": os arquivos temporários do banco passaram a ficar no volume de dados, não no `/tmp` de 64 MB do contêiner.
- Um erro do servidor sem resposta em JSON passou a mostrar "Não foi possível concluir a ação", em vez de "Unexpected token ... is not valid JSON".

## 0.32.2

### Changed
- O envio pelo WhatsApp passou a esperar até 30 segundos pela resposta do OpenWA, em vez de 12, reduzindo os envios marcados como "Envio requer verificação" quando o serviço está lento.

### Fixed
- O guia de implantação passou a indicar que a limpeza das respostas brutas terminou quando `text` e `cursor` de `progress()` chegam a 0, sem esperar `expired` em 0, que volta a subir a cada hora.

## 0.32.1

### Added
- Script `scripts/compact.py`, que devolve ao disco o espaço liberado no banco (VACUUM) com a aplicação parada e mostra o tamanho antes e depois; recusa sem alterar nada se outra conexão estiver com o banco aberto ou se faltar espaço livre no volume de dados.
- Função `backend.retention.progress()`, que mostra quantas respostas brutas vencidas e sem compactação a limpeza horária ainda tem a tratar, com o banco aberto só para leitura.
- A limpeza horária passou a registrar no log quantas respostas brutas e ciclos removeu e quantas respostas compactou.

### Changed
- Respostas brutas da fonte passaram a ser gravadas compactadas, ocupando menos espaço no banco; versões até a 0.32.0 não as leem, e voltar a uma delas passou a exigir a restauração do backup.
- A limpeza horária passou a compactar aos poucos as respostas brutas gravadas por versões anteriores, até 5 mil por hora, das mais novas para as mais antigas.
- A limpeza horária passou a remover até 10 mil respostas brutas vencidas por hora, antes 2 mil, em transações de até 500 linhas, para que reduzir `RADAR_RAW_RETENTION_DAYS` libere espaço sem bloquear o banco por longos períodos.
- A retenção passou a manter as respostas brutas reaproveitadas por uma versão mais nova dos filtros.

### Fixed
- `RADAR_RAW_RETENTION_DAYS` definido em `deploy/cloud.env` passou a chegar à aplicação na implantação com `compose.cloud.yaml`; antes valia sempre o padrão de 30 dias.

## 0.32.0

### Added
- "Esqueci minha senha" passou a enviar um código de 6 números pelo WhatsApp ou por e-mail, à escolha, e a nova senha passou a ser criada na mesma tela, com o código.
- O botão "Reenviar código" passou a ficar disponível após 60 s, com a contagem na tela.
- A auditoria passou a mostrar o canal (WhatsApp ou e-mail) de cada recuperação solicitada.
- Com a conta bloqueada por tentativas erradas, a tela de recuperação passou a informar os minutos de espera e a manter o código digitado até liberar "Criar nova senha".

### Changed
- O código de recuperação passou a valer 10 minutos e 5 tentativas; cada conta recebe no máximo um código por minuto e cinco por hora, e um novo pedido invalida o anterior.
- Códigos errados na recuperação passaram a contar como falhas de login, e a confirmação passou a esperar o fim de um bloqueio da conta.
- Mensagens de recuperação não enviadas em 10 minutos passaram a expirar, e as do WhatsApp saem mesmo no horário silencioso.
- Mensagens de recuperação passaram à frente das demais na fila de envio, e o texto com o código passou a ser apagado do registro de envios quando a mensagem sai da fila.
- O limite de pedidos de recuperação por IP passou a contar endereços IPv6 pelo prefixo /64, como o login.
- Depois da nova senha, a tela passou a voltar ao login com o aviso "Senha criada. Entre com a nova senha.".

### Removed
- O link de recuperação por e-mail; links enviados antes desta versão deixaram de funcionar e abrem o login.

## 0.31.0

### Added
- Cartão Ritmo na aba Saúde com números medidos nos últimos 15 min: consultas por minuto ao lado do limite de 12, tempo de resposta (mediana e p95) e de quanto em quanto tempo as viagens são atualizadas, contra a meta de 5 min.

### Removed
- Estimativa de capacidade da fonte e o alerta "capacidade alta", que avisava sobre uma projeção e não sobre um efeito real; o atraso da fila e as falhas da fonte continuam vigiados.

## 0.30.1

### Changed
- O menu de ações da viagem passou a usar um verbo por ação (Editar, Pausar, Encerrar…, Excluir…), sem repetir "monitoramento", e o botão de confirmação de encerrar passou a dizer "Encerrar".

## 0.30.0

### Added
- Aba Saúde na Administração, agora a primeira e a que abre por padrão, com indicador geral (Saudável, Atenção, Crítico) e o motivo.
- Números de saúde: viagens ativas, consultas na hora e em 24 h, taxa de sucesso, tempo de resposta (mediana e p95), viagens atualizadas e atraso da fila.
- Gráfico de 24 h das consultas por hora (com resultado, sem resultado, erro, bloqueio) e mediana de resposta.
- Listas de rotas lentas, rotas com falha e viagens sem resultado, com link para o monitoramento.
- Incidentes com abertura e fechamento por checagens seguidas, botão "Reconhecer" e histórico.
- Avisos de saúde ao administrador por WhatsApp e e-mail: ao abrir, lembrete a cada 2 h, e "Resolvido"; o canal com problema não é usado para avisar dele mesmo.
- Rota de controle consultada a cada 30 min para medir a fonte mesmo sem viagens.
- Capacidade usada da fonte e quantas viagens ainda cabem no intervalo de 5 min.
- Resumo diário opcional às 08:00 com os números do dia anterior.

### Changed
- O tempo de cada consulta à fonte passou a ser registrado, por 7 dias.

## 0.29.0

### Added
- A lista de voos da viagem passou a ordenar por menor preço, menor duração, saída mais cedo ou mais tarde e chegada mais cedo, só na tela.
- Chips de escalas, horário de saída e companhia filtram a lista na hora, com "Mostrando X de Y · Limpar", sem mudar o monitoramento nem os alertas.
- Botão "Atualizar" na página da viagem, com contagem regressiva de 60 s por viagem e limite de 10 atualizações manuais por hora por conta.

### Changed
- Uma viagem nova passou a ser coletada logo após a criação, à frente da fila.
- O botão "Filtros" da lista virou "Critérios", que muda o que a viagem monitora.

## 0.28.1

### Fixed
- Redimensionar o navegador com viagens de alturas diferentes na barra lateral deixou de levar à tela "Algo deu errado".

## 0.28.0

### Changed
- Barra lateral, barras do celular, menus, diálogos, avisos e barra de alterações passaram a usar vidro translúcido (Liquid Glass) sobre um fundo com luz ambiente; listas, cartões e formulários continuam sólidos.
- No computador a barra lateral flutua afastada das bordas, e no celular a barra de abas virou uma pílula flutuante.
- Transparência reduzida, contraste aumentado e navegadores sem desfoque recebem superfícies opacas.
- Idioma e tema viraram dois botões de ícone na barra lateral e nas telas de entrada, com bandeiras e Sistema, Claro e Escuro num menu pequeno.
- A lista de viagens da barra lateral passou a mostrar todas as viagens que cabem na altura da tela, e só pagina quando falta espaço, com o paginador na linha do título.

### Fixed
- A paginação da lista de viagens deixou de aparecer empilhada na barra lateral.

## 0.27.1

### Changed
- Cartões de ida e volta passaram a destacar o total estimado como valor principal, com a tendência do total, e a mostrar ida e volta numa linha compacta abaixo.

## 0.27.0

### Added
- Cartões da tela inicial passaram a mostrar o total estimado de ida + volta, somando os menores preços de cada trecho.
- Cada preço da tela inicial passou a mostrar se caiu, subiu ou ficou estável em relação a 24 h atrás ou à primeira coleta.
- Busca de aeroporto passou a aceitar vários códigos de uma vez (GRU+CGH+VCP, separados por +, vírgula, ponto e vírgula ou barra), adicionando todos com Enter ou ao colar.
- Digitar um código seguido de + (GRU+) passou a adicionar o aeroporto na hora e manter o campo aberto para buscar o próximo pelo nome.

### Changed
- Cabine e moeda viraram uma linha-resumo recolhível na etapa Viagem, liberando espaço no assistente.

## 0.26.0

### Added
- Seletor de aparência (Sistema, Claro, Escuro) no menu, no Perfil e no login; a escolha fica salva no aparelho e vale desde o carregamento.
- Linha "Você será avisado por" na revisão da viagem, mostrando os canais e destinos escolhidos.
- Campo de WhatsApp na revisão da viagem para quem ainda não tem número; o número é salvo no perfil ao criar a viagem.
- Nome da viagem, horário da cotação e link da viagem nas mensagens de WhatsApp e e-mail.
- Menor preço atual exibido sob a meta ao configurar alertas.
- Botão "Retomar" no cabeçalho da viagem pausada.
- Aviso quando datas de volta ficam antes da ida e mensagem ao atingir o máximo de 3 aeroportos.
- Exportação do histórico da viagem em CSV, que abre no Excel com acentos e separador `;`.
- Faixa de bloqueios em Administração › Envios, com a causa e o atalho para resolver.
- Aviso na administração quando os links dos alertas apontam para o próprio computador, indicando `RADAR_PUBLIC_URL`.
- Verificação em duas etapas para o administrador, com aplicativo autenticador, códigos de recuperação e script local para desativar.
- Lembrete para o administrador sem verificação em duas etapas.

### Changed
- Viagens novas vêm com WhatsApp ligado e e-mail desligado; viagens existentes mantêm seus canais.
- WhatsApp aparece antes do e-mail em todas as telas, e cada canal ocupa uma linha com a ajuda num ícone de informação.
- Status de envio passou a ícone do canal com rótulo colorido (Enviando, Enviado, Entregue, Lido, Falha, Verificar, Silenciado, Cancelado); a administração mantém o detalhe técnico.
- Preço que continua na meta deixou de gerar aviso a cada 2 h: novo aviso só em nova mínima ou na volta à meta, e no máximo um lembrete por dia ("Ainda dentro da meta").
- Avisos do horário silencioso ficam retidos e saem quando a janela termina, se o preço ainda valer; desligar o horário libera os retidos.
- Editar só o nome ou os canais da viagem não reenvia o aviso; mudar a busca, a meta ou a queda mínima recomeça a contagem.
- Página da viagem mais compacta, com menor preço e alertas num bloco e filtros num botão; no celular o primeiro voo aparece sem rolar.
- Selo de Alertas conta só os avisos ainda não vistos neste aparelho.
- Data de volta não escolhida passa a ficar depois da ida.
- Quadros vazios e frases fixas saíram de Alertas e da Administração; a ajuda ficou em ícones de informação.
- Cadastro grava o fuso do aparelho, e o Perfil oferece usar o fuso do aparelho quando a conta está em UTC.
- Interface redesenhada com componentes compartilhados, compatível com Safari/iOS 15.4, Chrome/Edge 100 e Firefox 100.
- Inglês, espanhol e o editor de viagem carregam sob demanda, reduzindo o JavaScript da primeira página de 755 kB para 421 kB.
- Papéis na tabela de usuários aparecem como Admin ou Cliente.
- Limites de login por conta e por IP, auditoria agregada com cotas e registro das mudanças de configuração.
- Coleta pausa toda a fonte ou uma busca quando o Google Voos falha, em vez de repetir consultas.
- Logs em JSON, respostas comprimidas e cache dos arquivos estáticos.
- Reinício do serviço aguarda até 30 s pela coleta e pelos envios em andamento.
- GitHub Actions passou a usar Node.js 24.

### Fixed
- Alerta dentro da meta deixou de aparecer como "Preço subiu".
- Encerrar uma viagem deixou de mostrar o aviso duas vezes.
- Reinício durante a coleta deixou de registrar falha de rota.
- Mensagem sobre o cliente Google ausente passou a indicar a configuração do cliente Desktop ou SMTP.
- Selo de Alertas passou a ter contraste legível.

### Removed
- Opção "Telegram — Em breve" das telas do usuário e da administração.
- Textos "Aceito pelo provedor" e legendas de estados nas telas do usuário.

## 0.25.0

- Confirmações de envio, entrega e leitura do WhatsApp por webhook assinado, com configuração administrativa e associação por mensagem e integração.
- Eventos repetidos, fora de ordem e anteriores à gravação do envio tratados sem reenvio automático.
- Estados, contagens por destinatário, horários de confirmação e filtros na Administração; resumo por canal nos alertas.

## 0.24.1

- Nome do produto e mensagens unificados, com descrições mais curtas e sem referências desnecessárias ao ambiente de execução.
- Teste de navegação independente do build local, corrigindo a falha no GitHub Actions.

## 0.24.0

- Seletor de idioma com bandeiras do Brasil, Estados Unidos e Espanha; cartões de viagem com alturas iguais e áreas de datas/preços alinhadas.

- Dimensões compartilhadas de ações e formulários, cabeçalho compacto de viagem e seletor estável entre voos, histórico e alertas.
- Correções de contenção de botões, barra de alterações acima da navegação móvel e datas completas em painéis estreitos.
- Legenda do gráfico alinhada às séries, preços mantidos sem falso desconto e economia com precisão adequada.
- Bloqueios de contato/serviço distinguidos de falhas de transporte, com classificação dos registros legados sem tentativas e atalhos de correção.
- Auditoria com filtros, paginação, retenção real, estados de consulta e leitura adaptada ao celular.
- Campos compartilhados de fuso e senha na Administração e recuperação; moeda com aviso visível e revisão dos valores.
- Organização e vocabulário de viagens unificados, acesso administrativo no menu da conta e identificação do serviço de e-mail em uso.

## 0.23.0

- Tipografia nativa e paleta semântica com modos claro/escuro automáticos pelo sistema, abrangendo login, calendários, gráficos e administração.

- País do telefone pesquisável por nome ou DDI, sem prefixo repetido no número; login com opção de mostrar/ocultar senha.

- Cabeçalho e navegação estáveis entre voos, histórico e alertas da viagem, com intervalos completos de ida/volta.
- Revisão por trecho com horários e filtros, recuperação de progresso do rascunho e descarte explícito.
- Disponibilidade e destinatários dos alertas validados na interface; cartões, gráfico, datas de avisos, pluralização e seleção de fuso revisados.

- Criação e edição de monitoramentos em páginas, com etapas no endereço e rascunho de nova busca por conta na sessão do navegador.
- Navegação móvel simplificada, perfil em largura completa e administração com páginas para cadastros, envios e consulta de monitoramentos.
- Filtros e limpeza manual recolhidos; histórico adaptável com escala de preços legível e indicação de estabilidade.
- Proteção de formulários alterados ao navegar e retorno explícito de monitoramentos inexistentes ou pertencentes a outra conta.

## 0.22.0

- Identificadores numéricos permanentes para clientes e monitoramentos, com migração dos registros existentes.
- Contagem de monitoramentos por usuário e consulta administrativa somente leitura, com filtros e paginação.
- Consulta de detalhes registrada na auditoria, mantendo a sessão do administrador e sem novas coletas.

## 0.21.1

- Histórico e painel da busca exibem ícones, estados e contagens de envio por canal, sem expor contatos ou diagnósticos técnicos.
- Indicação explícita de envio parcial e de registros incompletos após retenção.

## 0.21.0

- Alertas WhatsApp com negrito, singular/plural correto e ida/volta agrupadas sem título repetido.
- E-mails de oportunidades com cartões, botões e alternativa em texto simples, via SMTP ou Gmail.
- Links curtos de pesquisa com expiração em 30 dias e destino restrito ao Google Voos.
- Campos de duração com dimensões próprias, unidades visíveis e adaptação a espaços estreitos; ajustes de quebra em formulários e abas móveis.

## 0.20.2

- Conexão Google OAuth Web no domínio de produção, com configuração administrativa e callback HTTPS.
- Versão exibida no login e na área da conta.
- Catálogo de traduções incluído no runtime Docker e verificado no CI.

## 0.20.1

- Altura e aparência dos seletores de país e idioma padronizadas para Safari.
- Espaçamento do cabeçalho de acesso ajustado.

## 0.20.0

- Implantação Docker com volume persistente, modo público HTTPS e proxy externo.
- Assistentes de administrador, backup e restauração.

O histórico completo do código está nos commits do repositório.
