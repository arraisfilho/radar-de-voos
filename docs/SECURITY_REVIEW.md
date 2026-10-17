# Segurança e limites

## Proteções implementadas

- Senhas com Argon2id; sessões revogáveis em cookies HttpOnly/SameSite e Secure em produção.
- Autorização por proprietário e papel administrativo, proteção de origem/token para alterações e limitação de tentativas de login por IP (IPv6 por prefixo /64) e por conta ([política](ACCOUNTS.md#limite-de-tentativas-de-login)). A chave por conta é um HMAC-SHA-256 do telefone com segredo do servidor; o telefone digitado não fica recuperável a partir dela.
- Até quatro cálculos de senha Argon2 simultâneos; uma requisição além dessas vagas espera até 0,3 segundo por uma delas e, se nenhuma se libera, recebe HTTP 503 com `Retry-After: 5`.
- `/api/health` responde só `ok` a clientes externos sem sessão de administrador; versão, trabalhadores e estado da fonte ficam para o loopback e o administrador.
- Auditoria de acessos e de alterações administrativas (remetentes, integrações, retenção e limpeza manual) com autor e campos alterados, sem valores secretos. Eventos anônimos, de conta e administrativos têm cotas separadas: nenhum titular de conta remove registros administrativos gerando outros eventos.
- Logs em JSON com identificadores, sem senhas, tokens, telefones, e-mails ou corpo de mensagens.
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

Não há MFA administrativo, confirmação de posse de telefone/e-mail, alta disponibilidade ou auditoria de segurança independente. Validação sintática de contato não comprova titularidade. Aceitação de mensagem pelo transporte não comprova entrega.

O bloqueio por conta vale para qualquer IP: quem conhece um telefone cadastrado consegue mantê-lo bloqueado com cerca de quatro senhas erradas por hora e uma nova sequência de cinco falhas quando as primeiras expiram, após 24 horas. A redefinição de senha pela recuperação por e-mail ou pelo administrador libera a conta na hora, mas não impede um novo bloqueio ([detalhes](ACCOUNTS.md#limite-de-tentativas-de-login)).

Recomendação, não implementada: um cookie de dispositivo conhecido, emitido após um login com sucesso, permitiria que esse dispositivo seguisse tentando durante um bloqueio da conta causado por outros IPs, mantidos o limite por IP e um limite próprio por cookie.

A exposição pública exige avaliação de capacidade, controles de abuso e condições de uso da fonte de tarifas. Consulte [contas](ACCOUNTS.md), [operação](DEPLOYMENT.md) e [validação](VALIDATION.md).
