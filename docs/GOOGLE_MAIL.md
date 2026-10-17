# Envio de e-mail com Google

O administrador conecta a conta remetente. Os usuários apenas cadastram os destinatários no perfil. Credenciais e autorizações não acompanham o repositório.

## Produção: OAuth Web

1. No [Google Cloud](https://console.cloud.google.com/), habilite **Gmail API** e configure público e consentimento. O aplicativo solicita `openid`, `email` e `https://www.googleapis.com/auth/gmail.send`.
2. Em **Google Auth Platform → Clientes**, crie um cliente **Aplicativo da Web**.
3. Em **Administração → Canais → E-mail → Integração Google do servidor**, copie a **URL de retorno autorizada** e cadastre-a exatamente no cliente Google. Ela é derivada do domínio público e termina em `/api/google/callback`.
4. Informe **Client ID** e **Client Secret** no painel e salve. Depois, informe o e-mail remetente e clique em **Continuar** para autorizar no Google.
5. Solicite um envio para o **E-mail para teste** e consulte o resultado em **Administração → Envios**.

A configuração do cliente é feita uma vez por instalação. Aplicativos em teste podem exigir usuários de teste; público Interno é restrito à organização Workspace correspondente. Verificação do aplicativo depende do público e dos escopos usados. Referência: [OAuth para aplicações Web](https://developers.google.com/identity/protocols/oauth2/web-server).

## Instalação local: cliente Desktop

O fluxo Desktop exige um cliente próprio e autorização no computador que executa a aplicação. Ele não substitui o cliente Web da produção.

Com o JSON Desktop fora do repositório:

```sh
python3 scripts/prepare_google_release.py /caminho/privado/cliente-desktop.json
```

O script gera o manifesto com identificador e tipo, descartando segredos. O manifesto, isoladamente, pode não bastar para concluir a troca de autorização: o cliente pode exigir provisionamento privado da credencial. Não publique o JSON original nem tokens. Referência: [OAuth para aplicativos instalados](https://developers.google.com/identity/protocols/oauth2/native-app).

## Credenciais e diagnóstico

- Segredo e tokens ficam no diretório privado persistente, em `google-oauth-private.json`, com modo 0600.
- Segredo vazio preserva o existente para o mesmo Client ID. Trocar o cliente exige nova autorização.
- A autorização usa PKCE e estado de uso único vinculado à sessão administrativa ativa.
- Se o retorno for recusado, confira domínio e URL autorizada. Se a conta for bloqueada, confira público, usuários de teste e consentimento no Google Cloud.
- Autorização concluída não comprova entrega. Verifique o envio de teste e a caixa de destino.
- `DELETE /api/google/client` apaga `google-oauth-private.json` (cliente e tokens), sem revogar a autorização na conta Google. Desconectar remove só os tokens.
- Salvar ou remover o cliente, conectar e desconectar ficam na auditoria com o administrador e os nomes dos campos alterados, sem valores.

## Alternativa: SMTP

Em **Administração → Canais → E-mail → Configuração manual SMTP**, informe servidor, porta, segurança, usuário e credencial exigida pelo provedor. Configure remetente, habilite e salve. Use o campo de teste para validar o transporte. As contas dos clientes não configuram SMTP.

`DELETE /api/smtp` apaga `smtp-private.json`; uma conta Google conectada não é afetada. Salvar e remover o SMTP ficam na auditoria, sem a senha.
