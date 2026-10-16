# Contas e contatos — revisão 0.3

## Fluxos implementados

1. Primeiro administrador: no Mac, abrir http://127.0.0.1:8765/, escolher “Configurar o primeiro administrador neste Mac” e cadastrar nome, telefone internacional e senha. Não há senha padrão nem administrador criado automaticamente. Se a conta já existir, a senha existente é exigida antes da promoção. A operação fica bloqueada assim que houver um administrador.
2. Usuário: na rede autorizada, criar conta ou entrar com país/DDI, telefone (DDD + número) e senha. A seleção de país mostra bandeira e DDI; o número é armazenado em E.164, com unicidade por número normalizado.
3. Meu perfil: nome, até quatro e-mails, telefone de acesso exibido e escolha do contato de WhatsApp. O padrão reaproveita o telefone de acesso; desativá-lo permite outro número com país próprio.
4. Alertas: ativados por busca. O transporte SMTP é global e administrativo; os destinatários são individuais por conta. Todos os e-mails cadastrados recebem a mensagem. Sem contato, o evento fica no painel como aguardando e-mail. Nenhuma mensagem é enviada retroativamente ao adicionar contatos.
5. Sair: revoga a sessão atual e remove o cookie. O frontend limpa os dados em memória para evitar reaproveitar o estado de outra conta.

## Contratos da API

| Rota | Acesso | Finalidade |
|---|---|---|
| GET /api/auth/session | Público na rede autorizada | Estado de acesso, token de proteção de alterações e disponibilidade de configuração inicial local. |
| POST /api/auth/register | Público, com proteção de origem/token | Criar usuário comum; papel administrativo não pode ser escolhido pelo cliente. |
| POST /api/auth/bootstrap | Somente loopback, antes do primeiro admin | Criar/promover administrador com senha válida e assumir buscas legadas sem proprietário. |
| POST /api/auth/login | Público, com proteção de origem/token | Entrar por telefone/senha; limite de tentativas incorretas por endereço. |
| POST /api/auth/logout | Proteção de origem/token | Revogar a sessão apresentada. |
| PUT /api/profile | Autenticado | Alterar nome, e-mails e contato de WhatsApp da própria conta. |
| GET /api/state e rotas de buscas/exportação | Autenticado | Somente dados do proprietário. |
| PUT /api/smtp e POST /api/smtp/test | Administrador | Configuração do transporte e envio de teste solicitado explicitamente. |

As sessões usam identificador aleatório em cookie HttpOnly/SameSite=Strict, com digest no servidor e validade de sete dias. As senhas usam Argon2id; nem senha nem hash saem pela API. Cadastros/contatos/bancos/sessões são dados de execução fora do Git. O e-mail de teste administrativo nunca é usado como fallback de destinatário de uma busca.

## Migração e limites

As buscas anteriores, seus preços e históricos são preservados. A primeira conta administradora recebe as buscas que estavam sem dono. Outros usuários começam com suas próprias buscas vazias. Foi feito backup privado do SQLite anterior à migração. O projeto continua local, sem criação de remoto ou push no GitHub.

O ambiente usa HTTP na rede local para testes; não é uma configuração de autenticação pronta para hospedagem pública. HTTPS/cookies Secure, confirmação de telefone/e-mail, recuperação de senha, mudança verificada do telefone de acesso e controles de abuso de cadastro são próximos requisitos de produção. Telefone válido em formato não comprova posse, nem disponibilidade do WhatsApp. Endereços de e-mail recebem validação sintática, sem confirmação de caixa postal. O telefone de acesso não é alterável pelo formulário de perfil nesta versão.

WhatsApp e Telegram ainda não enviam mensagens. O contato alternativo de WhatsApp já tem contrato e persistência para a futura integração. SMTP e a API Gmail via OAuth são os transportes implementados; a conexão Google depende da configuração do cliente OAuth e do consentimento. Testes automatizados usam números de exemplo, contas temporárias e transporte simulado; nenhuma credencial real deve ser inserida em testes ou no código.
