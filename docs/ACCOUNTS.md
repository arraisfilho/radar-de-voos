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

Em **Esqueci minha senha**, informe o celular de acesso e escolha onde receber o código: **WhatsApp** (padrão) ou **E-mail**. Na mesma tela, digite o código de 6 números e a nova senha. Trocar o celular ou o canal volta ao primeiro passo.

- O WhatsApp usado é o do perfil (o celular de acesso ou o número alternativo), nunca os números adicionais. O e-mail usado é o primeiro do perfil.
- A resposta é sempre `{"ok": true}`: telefone sem conta, conta sem o contato escolhido, canal sem integração ou envio configurado e pedidos acima dos limites não recebem código, sem aviso.
- O código vale 10 minutos e aceita 5 tentativas. Cada tentativa é contada antes da comparação; na quinta, o código deixa de valer. Um novo pedido invalida o código anterior e cancela a mensagem dele ainda não enviada.
- Por conta, sai no máximo um código por minuto e cinco por hora. Por IP (em IPv6, o prefixo /64), são aceitos cinco pedidos por hora.
- Cada confirmação conta como tentativa de login: código errado, código vencido e telefone sem conta são falhas no [limite de tentativas](#limite-de-tentativas-de-login). Com a conta ou o IP bloqueado, a confirmação recebe HTTP 429 com `Retry-After` e não gasta tentativa do código; a tela informa os minutos de espera, mantém o código digitado e libera **Criar nova senha** quando a espera termina.
- A mensagem sai na hora, inclusive no horário silencioso, no idioma da tela (português, inglês ou espanhol), à frente das demais mensagens do canal. Se não sair em 10 minutos, expira. Em **Administração → Envios** aparece com o tipo **Recuperação de acesso**, sem o conteúdo. Quando a mensagem deixa a fila (enviada, com falha, expirada ou cancelada), o texto com o código é apagado do banco.
- Alterar os e-mails ou o WhatsApp do perfil, ou o celular de acesso pelo administrador, invalida o código aberto.
- O código é guardado como HMAC-SHA-256 com um segredo do servidor, ligado à conta e ao pedido. O segredo fica em `recovery-private.json` (modo 0600) no diretório de dados, é criado no primeiro código e entra no backup com os demais arquivos privados. Se o arquivo for removido, um novo segredo é criado e os códigos abertos deixam de valer.
- A nova senha encerra todas as sessões da conta e apaga as falhas de login dela. A [verificação em duas etapas](#verificação-em-duas-etapas) continua ativa e é pedida no próximo login.
- Links de recuperação enviados por versões anteriores deixam de funcionar; quem abre um deles vê o login.

| Rota | Corpo | Resultado |
|---|---|---|
| `POST /api/auth/recovery` | `country`, `phone`, `channel` (`whatsapp` ou `email`) | Sempre `{"ok": true}` |
| `POST /api/auth/recovery/confirm` | `country`, `phone`, `code` (6 dígitos), `password` (10 a 200 caracteres) | `{"ok": true}`; HTTP 422 `Código inválido ou vencido. Peça um novo.`; HTTP 429 durante um bloqueio |

O assistente `create_admin.py` não redefine senhas existentes. Se houver outro acesso administrativo disponível, use **Administração → Usuários** para redefinir a senha. Sem acesso administrativo e sem WhatsApp ou e-mail na conta, a recuperação depende de intervenção do operador no servidor.

Não envie senhas ou códigos de recuperação em issues públicas.

## Limite de tentativas de login

- Por IP: 10 falhas em 15 minutos bloqueiam novas tentativas desse IP, inclusive com a senha correta, até a falha mais antiga expirar. Endereços IPv6 contam pelo prefixo /64, que costuma pertencer inteiro a um mesmo assinante; IPv4, inclusive mapeado em IPv6, conta pelo endereço.
- Por conta, de qualquer IP: a 5ª falha em 15 minutos bloqueia a conta por 1 minuto. Cada falha seguinte da mesma sequência bloqueia por 2, 4, 8 e depois 15 minutos, contados da última falha. A sequência recomeça após uma hora sem falhas.
- Telefones sem cadastro são contados da mesma forma e recebem respostas idênticas.
- Um login com sucesso zera somente os contadores daquela conta. Com a verificação em duas etapas ativa, só o login completo (senha e código) zera; a senha correta sozinha não apaga falhas anteriores e ocupa uma vaga do limite por IP.
- A redefinição de senha pelo código de recuperação ou pelo administrador também apaga as falhas registradas da conta e libera o bloqueio na hora. Como no login com sucesso, essas falhas deixam de contar também no limite por IP. A confirmação do código, como o login, espera o bloqueio terminar.

O bloqueio responde HTTP 429 com o cabeçalho `Retry-After`, em segundos. A tentativa é reservada como falha antes da verificação da senha; tentativas simultâneas não ultrapassam os limites.

Como o bloqueio da conta vale para qualquer IP, quem conhece um telefone cadastrado consegue mantê-lo bloqueado com cerca de quatro senhas erradas por hora: cada falha renova a espera de até 15 minutos. As falhas expiram em 24 horas; quando expiram as cinco que abriram a sequência, o bloqueio termina, a menos que ocorram outras cinco falhas em 15 minutos, o que recomeça a sequência. Nesse caso, a recuperação por código também espera cada bloqueio terminar; peça a redefinição ao administrador.

As falhas são guardadas por 24 horas com o IP (em IPv6, o prefixo /64) e uma chave da conta: HMAC-SHA-256 do telefone normalizado com um segredo do servidor, nunca o número. O segredo fica em `login-limit-private.json` (modo 0600) no diretório de dados, é criado na primeira tentativa de login e entra no backup com os demais arquivos privados. Se o arquivo for removido, um novo segredo é criado e os contadores existentes deixam de valer. Contadores gravados por versões anteriores, com SHA-256 sem segredo, também deixam de contar e expiram em 24 horas.

O processo executa até quatro cálculos de senha (Argon2) ao mesmo tempo: login, cadastro, redefinição e criação de conta pelo administrador. Se nenhum fica livre em 0,3 segundo, a resposta é HTTP 503 e a tentativa de login não conta como falha. A espera é curta porque a requisição em espera ocupa uma thread do conjunto que atende as demais rotas.

## Verificação em duas etapas

Opcional, para o administrador, em **Perfil → Segurança**. Depois de ativada, o login da conta pede a senha e um código de 6 dígitos de um aplicativo autenticador TOTP (RFC 6238: HMAC-SHA-1, passo de 30 segundos). Contas sem a verificação entram só com a senha.

Ativação:

- **Ativar** pede a senha atual e mostra um QR code com a URI `otpauth://` e o segredo em base32 para digitação manual. No aplicativo, a conta aparece como Radar de Voos com o telefone de acesso. A configuração vale por 10 minutos e aceita até 5 códigos errados; depois, comece de novo.
- O primeiro código válido ativa a verificação, encerra as outras sessões da conta, abertas só com a senha, e mostra 10 códigos de recuperação, que podem ser copiados ou baixados. Eles não são exibidos de novo.

Login:

- Com a senha correta, o servidor abre uma etapa provisória de 5 minutos, num cookie HttpOnly `radar_2fa`, e pede o código; a sessão só é criada depois dele.
- Cada conta mantém no máximo cinco etapas abertas por endereço (IPv4, ou prefixo /64 em IPv6). Logins de outro endereço, mesmo com a senha, não fecham a etapa em andamento.
- O código do aplicativo vale no passo atual, no anterior e no seguinte (cerca de 30 segundos de diferença de relógio) e não é aceito duas vezes.
- Um código de recuperação substitui o código do aplicativo uma única vez. Hífens, espaços e maiúsculas são ignorados. O perfil mostra quantos restam.

Limites:

- A segunda etapa usa os [limites de tentativas](#limite-de-tentativas-de-login) por IP e por conta da senha: cada código errado conta como falha.
- Cada senha correta ocupa uma das 10 vagas do limite por IP por 15 minutos, sem contar para o bloqueio da conta. Assim, abrir etapas e registrar senhas aceitas também tem limite por endereço.
- Códigos do aplicativo errados têm também um teto de 10 por conta em 24 horas. Atingido o teto, o código do aplicativo recebe HTTP 429 com `Retry-After` até a falha mais antiga completar 24 horas; códigos de recuperação continuam aceitos. Nem um login completo nem a redefinição de senha liberam o teto antes disso; desativar e ativar de novo libera. Falhas que não são suas indicam que a senha vazou: troque a senha.
- **Ativar** e **Desativar** conferem a senha com os mesmos limites do login: uma senha errada conta como falha.
- A redefinição de senha, pelo código de recuperação ou pelo administrador, encerra as etapas abertas com a senha anterior. A verificação continua ativa.

**Desativar** pede a senha atual e apaga o valor aleatório da ativação, os códigos de recuperação, as etapas abertas e o teto de códigos errados.

O segredo do autenticador não é gravado. Ele é derivado, por HMAC-SHA-256, de um valor aleatório de cada ativação, guardado no banco, e de uma chave do servidor em `two-factor-private.json` (modo 0600) no diretório de dados. A chave é criada quando a primeira ativação começa e entra no backup com os demais arquivos privados.

A chave nunca é recriada nem sobrescrita enquanto houver verificação ativa, nem quando o arquivo existe mas não pode ser lido (permissões). Nesses casos, o código do aplicativo e o início da ativação recebem HTTP 503, e o log registra `two_factor_key_unavailable`. Restaure o arquivo do backup ou corrija a permissão. Sem backup, entre com um código de recuperação, desative e ative de novo, o que cria uma chave nova. Os códigos de recuperação ficam como SHA-256 vinculado à conta e não dependem da chave.

A auditoria registra, sem segredo nem códigos nos detalhes:

| Evento | Quando |
|---|---|
| `login_2fa_started` | Senha correta numa conta com a verificação ativa, mesmo que o código não chegue |
| `login_2fa_failed` | Código recusado na segunda etapa |
| `recovery_code_used` | Login com código de recuperação, com o número de códigos restantes |
| `admin_2fa_enabled` | Ativação, com o número de sessões encerradas |
| `admin_2fa_disabled` | Desativação, pelo perfil ou pelo operador (sem autor) |

`login_2fa_started` e `login_2fa_failed` repetidos com o mesmo IP e conta em até 10 minutos são agregados, como as falhas de login.

| Rota | Corpo | Resultado |
|---|---|---|
| `GET /api/auth/2fa` | — | `enabled`, `enabled_at`, `recovery_codes_remaining` |
| `POST /api/auth/2fa/setup` | `{"password"}` | `secret` (base32), `uri` (`otpauth://`), `expires_in` |
| `POST /api/auth/2fa/confirm` | `{"code"}` | Estado e `recovery_codes` |
| `POST /api/auth/2fa/disable` | `{"password"}` | Estado |
| `POST /api/auth/login` | país, telefone e senha | `{"two_factor_required": true, "expires_in": 300}` quando a verificação está ativa |
| `POST /api/auth/login/2fa` | `{"code"}` ou `{"recovery_code"}` | Usuário e sessão; HTTP 410 se a etapa expirou |

As rotas `/api/auth/2fa` são exclusivas do administrador.

Sem o aplicativo e sem códigos de recuperação, o operador desativa a verificação no servidor. A senha não muda. As sessões da conta são encerradas, o bloqueio de login da conta é liberado e a auditoria registra `admin_2fa_disabled` sem autor:

```sh
.venv/bin/python scripts/disable_2fa.py
```

Em produção, com o serviço em execução:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml exec app python scripts/disable_2fa.py
```
