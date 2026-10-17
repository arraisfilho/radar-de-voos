# Alterações

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
