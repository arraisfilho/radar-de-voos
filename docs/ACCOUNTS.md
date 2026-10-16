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

Muitas tentativas incorretas de login causam bloqueio temporário. Não envie senhas ou links de recuperação em issues públicas.
