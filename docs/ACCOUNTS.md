# Contas e contatos

## Acesso e administração

O login usa país, telefone e senha. O telefone é normalizado em E.164 e a senha deve ter pelo menos dez caracteres. Não há credencial padrão.

Em produção, o primeiro administrador é criado pelo [assistente de instalação](DEPLOYMENT.md). O cadastro público é fechado; usuários são cadastrados em **Administração → Usuários**. O administrador pode editar contatos, preferências, limite de buscas e redefinir senhas. A redefinição revoga as sessões da conta.

Cada conta acessa somente seus monitoramentos, resultados, histórico e alertas. Configuração dos remetentes, credenciais, auditoria e retenção são exclusivas do administrador.

## Consulta administrativa de monitoramentos

Em **Administração → Usuários**, cada cadastro exibe o número do cliente e as contagens de buscas ativas, pausadas e encerradas. **Monitoramentos** abre a lista daquele usuário; selecione uma busca para consultar filtros e resultados já coletados, sem editar ou disparar consultas à fonte. A visualização de detalhes fica na auditoria e mantém a sessão administrativa.

Clientes e monitoramentos possuem sequências numéricas independentes. O número do monitoramento é global entre usuários, permanece após pausa/restauração e não é reutilizado após exclusão. Cadastros existentes recebem os números automaticamente; os IDs internos e vínculos permanecem preservados. Para localizar um cliente, pesquise `#N` na lista de usuários. A consulta administrativa é restrita ao papel administrador.

## Perfil e destinatários

- Até quatro e-mails para alertas.
- WhatsApp no telefone de acesso ou em um número alternativo, com até quatro telefones adicionais.
- Contato Telegram pode ser salvo, mas o envio ainda não está implementado.
- Idioma, fuso horário e preferências de silêncio.

As máscaras seguem o país selecionado. Validação de formato não comprova posse do contato. Alterar os destinatários não dispara alertas antigos; mensagens já em trânsito não podem ser retiradas.

## Limite de monitoramentos

O padrão é cinco buscas por conta, ajustável pelo administrador de 1 a 100. Buscas pausadas contam no limite; encerradas liberam espaço. Restaurar uma busca exige limite disponível e revisão das datas. A navegação lateral exibe cinco entradas por página.

## Recuperação de acesso

Em **Esqueci minha senha**, informe país e telefone cadastrados. Se houver remetente configurado e e-mail no perfil, o sistema envia um link ao primeiro endereço, válido por 20 minutos. Uma nova solicitação invalida links anteriores.

O assistente `create_admin.py` não redefine senhas existentes. Se houver outro acesso administrativo disponível, use **Administração → Usuários** para redefinir a senha. Sem acesso administrativo e sem recuperação por e-mail, a recuperação depende de intervenção do operador no servidor.

Não envie senhas ou links de recuperação em issues públicas.

## Limite de tentativas de login

- Por IP: 10 falhas em 15 minutos bloqueiam novas tentativas desse IP, inclusive com a senha correta, até a falha mais antiga expirar. Endereços IPv6 contam pelo prefixo /64, que costuma pertencer inteiro a um mesmo assinante; IPv4, inclusive mapeado em IPv6, conta pelo endereço.
- Por conta, de qualquer IP: a 5ª falha em 15 minutos bloqueia a conta por 1 minuto. Cada falha seguinte da mesma sequência bloqueia por 2, 4, 8 e depois 15 minutos, contados da última falha. A sequência recomeça após uma hora sem falhas.
- Telefones sem cadastro são contados da mesma forma e recebem respostas idênticas.
- Um login com sucesso zera somente os contadores daquela conta.
- A redefinição de senha pelo link de recuperação ou pelo administrador também apaga as falhas registradas da conta e libera o bloqueio na hora. Como no login com sucesso, essas falhas deixam de contar também no limite por IP.

O bloqueio responde HTTP 429 com o cabeçalho `Retry-After`, em segundos. A tentativa é reservada como falha antes da verificação da senha; tentativas simultâneas não ultrapassam os limites.

Como o bloqueio da conta vale para qualquer IP, quem conhece um telefone cadastrado consegue mantê-lo bloqueado com cerca de quatro senhas erradas por hora: cada falha renova a espera de até 15 minutos. As falhas expiram em 24 horas; quando expiram as cinco que abriram a sequência, o bloqueio termina, a menos que ocorram outras cinco falhas em 15 minutos, o que recomeça a sequência. Nesse caso, use a recuperação por e-mail ou peça a redefinição ao administrador.

As falhas são guardadas por 24 horas com o IP (em IPv6, o prefixo /64) e uma chave da conta: HMAC-SHA-256 do telefone normalizado com um segredo do servidor, nunca o número. O segredo fica em `login-limit-private.json` (modo 0600) no diretório de dados, é criado na primeira tentativa de login e entra no backup com os demais arquivos privados. Se o arquivo for removido, um novo segredo é criado e os contadores existentes deixam de valer. Contadores gravados por versões anteriores, com SHA-256 sem segredo, também deixam de contar e expiram em 24 horas.

O processo executa até quatro cálculos de senha (Argon2) ao mesmo tempo: login, cadastro, redefinição e criação de conta pelo administrador. Se nenhum fica livre em 0,3 segundo, a resposta é HTTP 503 e a tentativa de login não conta como falha. A espera é curta porque a requisição em espera ocupa uma thread do conjunto que atende as demais rotas.
