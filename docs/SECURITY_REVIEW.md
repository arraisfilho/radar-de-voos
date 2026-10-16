# Segurança e limites

## Proteções implementadas

- Senhas com Argon2id; sessões revogáveis em cookies HttpOnly/SameSite e Secure em produção.
- Autorização por proprietário e papel administrativo, proteção de origem/token para alterações e limitação de tentativas de login.
- Produção com domínio HTTPS explícito e confiança em um único IP de proxy.
- Cadastro público e configuração inicial pelo navegador desativados em produção.
- Links de oferta com identificador aleatório, validade limitada e destino restrito ao Google Voos; sem sessão ou dados de contato na URL.
- OAuth com PKCE e estado de uso único vinculado à sessão administrativa.
- Credenciais em arquivos privados com modo 0600, sem devolução dos segredos pela API.
- Container sem privilégios, raiz somente leitura, temporários separados e volume persistente.
- Exclusão de banco, credenciais, backups e dados de execução do Git e da imagem.

## Responsabilidades do operador

Configure TLS, proxy e firewall; restrinja a porta da aplicação ao proxy. Mantenha dependências atualizadas, monitore saúde e espaço e teste restaurações. Proteja backups como credenciais, pois contêm banco e tokens. Não execute múltiplas instâncias sobre o mesmo volume.

## Limitações

O projeto está em piloto. Não há MFA administrativo, confirmação de posse de telefone/e-mail, alta disponibilidade ou auditoria de segurança independente. Validação sintática de contato não comprova titularidade. Aceitação de mensagem pelo transporte não comprova entrega.

A exposição pública exige avaliação de capacidade, controles de abuso e condições de uso da fonte de tarifas. Consulte [contas](ACCOUNTS.md), [operação](DEPLOYMENT.md) e [validação](VALIDATION.md).
