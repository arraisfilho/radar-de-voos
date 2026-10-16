# Cadastros administrativos e gestão de logs — 0.13

## Administração → Usuários

A lista paginada permite buscar por nome, telefone ou e-mail. Cada conta tem ações **Editar** e **Senha**. **Novo usuário** cria uma conta comum sem entrar nela, alterar o administrador ou enviar e-mail automaticamente.

O formulário permite gerenciar:

- Nome e telefone internacional de acesso, com seleção do país e máscara.
- Senha inicial no cadastro e redefinição posterior em ação separada com confirmação.
- Até quatro e-mails de alerta.
- WhatsApp usando o telefone de acesso ou outro número internacional.
- Até quatro números adicionais, sem alterar o login.
- Usuário do Telegram, idioma, fuso horário e horário de silêncio.

Os números adicionais também podem ser editados pelo próprio cliente em **Meu perfil → Outros telefones**. Telefones são normalizados para E.164 e repetidos da lista adicional são deduplicados. E-mails e números são validados pelo servidor. Telefones de acesso continuam exclusivos por conta.

Salvar contatos não ativa WhatsApp/Telegram: as integrações de envio continuam futuras e são identificadas dessa maneira. O envio de e-mail continua usando a infraestrutura administrada globalmente, sem pedir SMTP ao cliente.

## Senhas e auditoria

Senhas usam o mesmo Argon2 do cadastro existente, nunca são devolvidas pela API nem armazenadas em texto. A redefinição exige pelo menos dez caracteres, encerra as sessões da conta alterada e invalida links de recuperação anteriores. Alterar o telefone de acesso também encerra suas sessões. Se o administrador alterar sua própria senha ou telefone de acesso, a página recarrega para novo login.

Não é possível atribuir a função de administrador pelo formulário ou pelos novos endpoints. A conta administrativa existente mantém seu papel. A edição é transacional: um telefone duplicado não deixa alterações parciais no cadastro.

Criação, edição e redefinição de senha registram a conta afetada e o administrador responsável, além dos dados de conexão já auditados. A aba Auditoria mostra quem realizou a ação, sem guardar senha ou cópia dos contatos no evento.

## Logs: exclusão e retenção

**Envios → Limpar logs** abre a área de limpeza de envios. **Auditoria → Limpar logs** abre a limpeza de acessos. Também há acesso direto pela aba **Retenção**.

Para cada tipo de log:

1. Definir **Manter logs por (dias)** e salvar. O padrão continua 90 dias; o intervalo permitido na administração é de 1 a 3.650 dias.
2. Na limpeza manual, escolher registros anteriores a uma data ou todos os elegíveis.
3. Consultar a prévia, revisar a quantidade, confirmar a exclusão definitiva e excluir o lote.

A retenção administrativa é persistida no banco e prevalece sobre o valor inicial das variáveis de ambiente. Reduzir o prazo permite apagar registros antigos na próxima manutenção. A manutenção ocorre a cada hora; a auditoria também faz limpeza ao registrar um novo evento e mantém seu teto de 20 mil registros.

Envios pendentes/em processamento são sempre protegidos. A prévia é assinada e vinculada também ao tipo de log, impedindo que uma confirmação de limpeza de acessos seja reutilizada para envios. A limpeza manual opera em lotes de até 2.000 registros; cada lote seguinte exige nova prévia. Contas, preços e oportunidades não são apagados.

Excluir logs libera páginas para reutilização pelo SQLite; não implica redução imediata do arquivo no disco. Backups privados têm ciclo de vida separado e não são apagados por esta ação.

## Validação e limites

151 testes Python, nove verificações frontend e compilação TypeScript/Vite. Os novos cenários usam contas fictícias e bancos temporários, cobrindo autorização, sessão administrativa preservada, persistência de contatos, duplicidade/rollback, revogação de sessões/recuperação, auditoria de autoria, preferências e limpeza por tipo de log. Os testes não cadastram clientes reais, redefinem senhas reais ou enviam mensagens externas.

A análise visual continua baseada nas capturas fornecidas e renderização isolada; a inspeção interativa permanece pendente pelo bloqueio de origem do navegador previamente documentado. Não houve publicação nem envio ao GitHub.
