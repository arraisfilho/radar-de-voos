# Administração compacta — versão 0.12

A administração agora oferece quatro abas, mantendo apenas a seção escolhida em tela:

- **Envios:** consulta de todos os usuários, com canal, situação, nome/login, assunto/destinatário e período. São 15 registros por página em uma área com altura limitada. Em telas estreitas, cada linha se transforma em um registro compacto. O botão **Ver** abre conteúdo, destinatários, horários, tentativas, serviço e erro registrado.
- **Canais:** configuração Google/Gmail e SMTP manual. WhatsApp e Telegram são espaços para integrações futuras, identificadas como indisponíveis; não configuram nem enviam mensagens.
- **Auditoria:** os acessos ficam isolados das configurações, com a lista em uma área de rolagem limitada. A política de auditoria permanece independente.
- **Retenção:** quantidade de registros, mensagens protegidas, prazo de retenção, última verificação e limpeza manual.

## Resultados e identificação

**Aceito pelo provedor** significa que a transmissão foi aceita pelo serviço de e-mail. Não comprova entrega na caixa de entrada, leitura ou aceitação de todos os destinatários em uma falha parcial. O sistema não inventa confirmação de entrega.

Cada novo registro preserva proprietário, canal e finalidade. O serviço efetivamente utilizado (Gmail ou SMTP) é gravado no momento da tentativa. Registros anteriores sem essa informação mostram **Não registrado**. Buscas antigas permitem recuperar seu proprietário; mensagens antigas sem vínculo suficiente permanecem **Não identificado**.

A lista não transfere o corpo de todas as mensagens. O conteúdo é solicitado ao abrir um registro e renderizado como texto. Mensagens de recuperação de acesso ocultam seu conteúdo para proteger links de segurança, inclusive registros antigos identificáveis pelo link de recuperação. Credenciais SMTP e OAuth não fazem parte dessas respostas.

A consulta usa um limite temporal estável para navegar pelas páginas. **Atualizar** volta à primeira página e inclui novos envios. Os filtros só geram consulta ao confirmar o formulário, evitando requisições a cada tecla. Isso consulta apenas o banco local, sem novas buscas na fonte de tarifas.

## Retenção dos registros de envio

Padrão: **90 dias após a conclusão**. Configuração de implantação: `RADAR_DELIVERY_RETENTION_DAYS`, inteiro de 7 a 3.650. A verificação ocorre a cada hora em lotes de até 2.000 registros. Grandes acúmulos são drenados em verificações sucessivas.

Podem ser removidos registros aceitos, falhos, incertos, cancelados, expirados e silenciados. Mensagens pendentes ou em processamento são sempre preservadas. Uma mensagem antiga que termina agora recebe o horário de conclusão atual; não é removida imediatamente por ter sido criada há muito tempo. Na migração, registros já concluídos usam o horário de envio disponível ou, na ausência dele, a criação.

A limpeza exclui o conteúdo e o registro operacional da transmissão. **Não exclui snapshots de preços nem o histórico de oportunidades do cliente**, que possuem finalidade e política separadas. Respostas brutas continuam com a retenção anterior de 30 dias. Esta configuração não estabelece um limite global de tamanho para todas as tabelas ou para os backups.

## Limpeza manual

1. Escolher **Concluídos antes de**; considera meia-noite da data no dispositivo e todos os usuários/canais.
2. **Consultar prévia** apresenta o número elegível e o tamanho do lote.
3. Marcar a confirmação de exclusão definitiva e clicar no botão com a quantidade exata.

A prévia expira em cinco minutos e tem assinatura vinculada ao administrador, data e conjunto elegível do lote. Se os registros do lote mudarem, a API exige nova prévia. A exclusão usa transação e o mesmo filtro de proteção dos pendentes. Havendo mais de 2.000 registros, cada lote exige nova consulta/confirmação.

Não foi executada limpeza manual do banco do usuário durante a implementação. Os testes usam bancos temporários, sem envios externos. Antes de mudanças na política, mantenha backup privado fora do Git.

## Validação

141 testes Python, oito verificações frontend e compilação TypeScript/Vite. Novos testes cobrem autorização/CSRF, consulta entre contas, paginação/filtros, conteúdo sob demanda, recuperação protegida, serviço real de envio simulado, canal futuro não enviado por SMTP, migração e limpeza automática/manual com proteção e assinatura. A renderização isolada usa dados fictícios; a inspeção visual interativa permanece pendente pelo bloqueio de origem do navegador já documentado.
