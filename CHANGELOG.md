# Alterações

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
