# Revisão para o primeiro deploy

## Verificado nesta entrega

- Runtime, banco, backups, tokens e segredos ignorados no Git e no contexto Docker. A identidade OAuth desta instalação também é excluída, embora o Client ID seja público.
- Imagem com usuário UID/GID 10001, raiz somente leitura, volume privado `/data`, temporários separados, sem capabilities adicionais e sem escalada de privilégios.
- Modo local preservado; modo público exige uma origem HTTPS explícita, Host correspondente, cookies Secure/HttpOnly/SameSite e proxy confiável por IP exato.
- Cadastro público e bootstrap administrativo HTTP fechados na nuvem. Primeiro administrador por terminal; depois os clientes são gerenciados pelo administrador.
- Sessões revogáveis, hash Argon2, token contra CSRF e regras de acesso por proprietário/administrador já existentes. Auditoria de IP depende de proxy corretamente configurado.
- Porta publicada só em loopback por padrão. O operador escolhe o proxy e responde pelo TLS/firewall. A aplicação não instala ou modifica Nginx.
- Só um worker/instância para não duplicar coletas e envios. Volumes preservados em atualização normal, logs de stdout limitados.
- Backup consistente SQLite e arquivos privados, com testes de integridade. Conteúdo do backup é sensível e deve ser guardado fora do servidor.

## Limitações que permanecem

Este é um piloto, não uma certificação de segurança. Antes de público amplo, revisar cadastro/recuperação e verificação de contatos, adicionar MFA para administrador, observabilidade/limites na borda e realizar teste independente de isolamento entre usuários. O serviço atual é de uma instância, sem alta disponibilidade. Não há promessa de disponibilidade ou autorização comercial da fonte de tarifas. O OAuth Google existente é local e não foi transformado em OAuth web nesta entrega.

Atualizar as imagens base e dependências faz parte da manutenção. O scanner local de staged blobs identifica classes conhecidas de credenciais e arquivos privados, mas não prova ausência de todo segredo possível; por isso houve também revisão do inventário inicial. Nenhum segredo real é usado nos testes.
