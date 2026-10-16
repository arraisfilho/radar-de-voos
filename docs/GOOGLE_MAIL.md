# Conta Google para enviar alertas

**Distribuição do código:** a identidade OAuth desta máquina é ignorada no Git e no Docker. Um clone novo não herda a conta conectada. A instalação local usa cliente Desktop; a nuvem usa um cliente Aplicativo da Web configurado pelo administrador.

## Conexão na nuvem (a partir de 0.20.2)

1. No [Google Cloud](https://console.cloud.google.com/), selecione o projeto, habilite **Gmail API** e configure o público/consentimento do Google Auth Platform. O fluxo pede `openid`, `email` e `https://www.googleapis.com/auth/gmail.send`. Se o aplicativo estiver em teste, autorize a conta como usuário de teste quando aplicável; público Interno atende somente a organização Workspace correspondente. O Google pode exigir verificação conforme público e escopos.
2. Em **Google Auth Platform → Clientes**, crie um cliente **Aplicativo da Web**, separado do Desktop local. Em **URIs de redirecionamento autorizados**, informe exatamente a URL que o painel do radar apresenta. Para esta instalação:

   ```text
   https://radar.arrais.net.br/api/google/callback
   ```

3. Abra **Administração → Canais → E-mail → Integração Google do servidor**. Preencha Client ID e Client Secret e salve. Deixar o segredo vazio preserva o existente somente para o mesmo Client ID. Trocar a integração remove a autorização anterior e requer reconexão.
4. Informe a conta remetente e clique em **Continuar**. O navegador abre o Google; a senha é informada somente lá. Após autorizar, a janela retorna ao domínio do radar. Se o provedor Workspace não for reconhecido pelo DNS, escolha **Minha conta é do Google**.
5. Informe o **E-mail para teste**, solicite o envio e consulte **Administração → Envios**. Autorização concluída e mensagem entregue são verificações distintas.

Configurar o cliente é uma etapa única por instalação. Client Secret e tokens são gravados com modo 0600 no diretório privado persistente; nunca devem ser colocados no repositório ou enviados pelo chat. Use HTTPS com `RADAR_PUBLIC_URL` correto. O Nginx existente encaminha o callback como as demais rotas, sem configuração especial. A autorização usa state de uso único vinculado à sessão administrativa ativa e PKCE. Contas comuns não configuram remetentes.

Referência: [OAuth para aplicações Web do Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## Para quem instala o radar localmente

Em uma distribuição preparada, o administrador abre **Administração → Adicionar conta de e-mail**, informa o endereço, clica em **Continuar** e autoriza no Google. Não cria projeto no Google Cloud nem informa Client ID/Secret. Gmail é reconhecido pelo domínio; Google Workspace pelo MX, com escolha manual caso haja intermediários. A senha é informada apenas ao Google.

A conexão é feita no computador que executa o radar, pelo endereço `http://127.0.0.1:8765/`, em navegador compatível com login Google. O callback local retorna para esse computador; não é um fluxo de conexão remota pelo celular. Depois de conectar, o serviço usa a autorização para enviar alertas em segundo plano enquanto estiver ligado. Os destinatários apenas cadastram seus e-mails no perfil, sem conectar uma conta Google.

**Registro local preparado em 16/10/2026.** O cliente Desktop “Radar de Voos — instalação local” foi criado no projeto Google existente e seu identificador público foi configurado no radar. Gmail API ativada; escopos openid, identificação por e-mail e gmail.send declarados. O público permanece **Interno**, restrito à organização Workspace. Autorização interativa, renovação e envio reais ainda precisam ser validados; distribuição para usuários externos exige revisar público e requisitos do Google. A preparação abaixo pertence aos mantenedores.

## Preparação pelo mantenedor, uma vez por aplicativo

O responsável pelo projeto registra sua identidade no Google, habilita Gmail API, prepara o consentimento e cria um cliente OAuth **Desktop**. A distribuição local usa um cliente público com PKCE e retorno loopback. Não é possível reutilizar a identidade do Mail da Apple. [OAuth oficial para aplicativos instalados](https://developers.google.com/identity/protocols/oauth2/native-app).

Com o JSON Desktop baixado fora do repositório, o mantenedor executa na raiz do projeto:

```sh
python3 scripts/prepare_google_release.py /caminho/privado/cliente-desktop.json
```

O script extrai somente tipo e identificador público para `config/google-oauth-public.json`; descarta segredo, tokens e outros campos. Rejeita credenciais Web. O arquivo público pode acompanhar a versão oficial no GitHub, mas não basta sozinho: o teste real de 16/10/2026 confirmou que o endpoint Google exige também a chave do cliente Desktop na troca de autorização. Nesta instalação ela foi provisionada no diretório privado, sem campos técnicos na interface. A preparação automática dessa chave em futuras distribuições ainda precisa ser definida; não considerar um clone novo pronto para conectar apenas por ter o Client ID. Cada instalação mantém a própria autorização localmente. Quem distribuir um aplicativo independente com outra identidade deve registrar sua própria aplicação.

Antes de disponibilizar para terceiros, validar login, renovação e envio reais e cumprir as exigências aplicáveis de consentimento/verificação do Google para `gmail.send`. Modo de teste, políticas Workspace e eventual aprovação administrativa podem limitar quem consegue autorizar. [Verificação de escopos sensíveis](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

Uma implantação web hospedada exige avaliar outro tipo de cliente, domínio/HTTPS e callbacks; não deve publicar um segredo Web. O suporte legado a cliente Web privado permanece no backend, sem campos na interface de uso comum.

## Armazenamento e envio

A API Gmail solicita `gmail.send`, `openid` e `email`, sem leitura de mensagens. Tokens ficam em `google-oauth-private.json`, modo 0600, no diretório privado de dados, fora do repositório. Nunca são devolvidos ao navegador. A autorização usa PKCE S256 e estado aleatório de uso único, válido por dez minutos, vinculado à sessão administrativa.

O serviço renova o acesso em segundo plano. Revogação exige reconectar, sem trocar silenciosamente para SMTP. Trocar o identificador distribuído não reutiliza tokens de outro aplicativo. Desconectar remove tokens locais; a concessão pode ser revogada também na Conta Google. Após desconectar, SMTP manual habilitado pode voltar a ser usado.

O teste administrativo envia somente quando solicitado, para a conta Google conectada. Alertas usam os destinatários do proprietário da busca. Resultados ambíguos não são repetidos; uma resposta 401 confirmada permite renovar e tentar uma única vez. Aceitação da API não comprova entrega.

## Validação

Os testes simulam os endpoints Google, cobrindo distribuição Desktop sem segredo por instalação, PKCE, callback loopback, renovação, restrições de sessão/admin, cancelamento e isolamento de tokens. Não houve login Google real, envio externo ou validação visual nesta revisão. O registro real foi criado em 16/10/2026; o teste interativo permanece pendente porque uma permissão salva do navegador bloqueou o acesso do agente à origem local.

## Correção 0.5.1 — retorno do login

O callback apresenta fundo claro e mensagem acessível, transmite o motivo seguro ao radar e guarda o diagnóstico administrativo para quando a janela auxiliar não renderizar. Não inclui descrições brutas do provedor, códigos ou tokens nas mensagens. Estados inválidos não alteram os diagnósticos salvos.

Teste direto do protocolo com código fictício: antes da correção, Google retornou `invalid_request` por ausência de `client_secret`; com a chave Desktop privada, retornou `invalid_grant`, esperado para esse código fictício. Isso valida a remoção desse bloqueio, não comprova login ou envio reais. Credenciais Web não são herdadas por clientes Desktop, e trocar o identificador continua exigindo reconectar.
