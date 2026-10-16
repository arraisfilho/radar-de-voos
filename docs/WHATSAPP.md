# WhatsApp e integradores — versão 0.16

## Configurar a OpenWA

Em **Administração → Canais → WhatsApp**:

1. Selecione **OpenWA** em Tipo de integração.
2. Informe a URL base do serviço, o **ID** da sessão e o token/API key. A URL não deve terminar em `/api` ou `/api/docs`. O ID é o identificador da sessão, não necessariamente seu nome amigável.
3. Marque **Habilitar envios por WhatsApp**, salve e clique em **Verificar sessão**. O resultado mostra o estado informado pelo integrador; `ready` indica sessão pronta naquele momento.
4. Se desejar um teste real, expanda **Enviar mensagem de teste**, informe país/número, marque a confirmação e envie. Acompanhe em **Administração → Envios**, filtrando WhatsApp.

A verificação consulta apenas a sessão configurada, sem criar, iniciar ou desconectar sessões e sem enviar mensagens. Se o estado exigir QR code/autenticação, conclua a conexão no painel da OpenWA. Salvar configurações não envia testes automaticamente. O teste tem limite de uma solicitação por minuto e a verificação uma a cada dez segundos.

O servidor pode sugerir uma URL inicial por `RADAR_WHATSAPP_URL`. O valor distribuído no exemplo de ambiente é vazio; não há chave padrão. No ambiente local desta entrega, a URL fornecida pelo usuário foi definida como sugestão.

## Ativar em uma busca

Em **Configurar alertas**, selecione **WhatsApp**. É possível combinar e-mail e WhatsApp ou usar apenas um deles. O canal só pode ser habilitado em uma nova seleção quando a integração global está configurada e habilitada. Uma seleção antiga pode ser desmarcada se o administrador desabilitar o serviço.

O número principal vem de **Meu perfil**: telefone de acesso ou número alternativo para WhatsApp. Os até quatro números adicionais também são destinatários. O servidor normaliza e deduplica todos eles. Contatos não são verificados como pertencentes a uma conta WhatsApp pela mera inclusão no perfil.

Buscas existentes continuam com WhatsApp desativado. A configuração não envia oportunidades antigas retroativamente. Cada oportunidade respeita a cadência, filtros, silêncio e deduplicação já existentes.

## Fila e resultados

Há uma tentativa independente por destinatário WhatsApp, com fila e trabalhador próprios. A falha no e-mail não bloqueia o trabalhador WhatsApp. Ida e volta elegíveis no mesmo ciclo podem ser agrupadas em uma mensagem.

Antes de transmitir, o servidor confere atividade/versão da busca, destinatário ainda cadastrado, horário de silêncio, idade do alerta e identidade da integração. Alterar URL/sessão/integrador ou desabilitar o canal cancela mensagens ainda pendentes vinculadas à configuração anterior. Uma operação já em andamento não é desfeita.

Alertas com mais de 30 minutos não são enviados. Uma interrupção durante o envio fica como **incerta** após reinício. Timeouts, falhas ambíguas do servidor e respostas sem confirmação válida não provocam reenvio automático. Isso evita duplicação após uma possível aceitação cujo retorno foi perdido.

Nos logs administrativos é possível filtrar WhatsApp, usuário, período e situação; abrir o texto enviado; consultar o destinatário, o integrador, a quantidade de tentativas e o ID retornado pelo provedor. **Aceito pelo provedor** não significa entrega ou leitura. A oportunidade tem situação agregada: na fila enquanto houver tentativas pendentes, aceita se todas forem aceitas, parcial se somente parte dos destinos for aceita, ou falha/incerteza quando aplicável. As tentativas individuais permanecem nos logs, sujeitas à retenção configurada.

## Credenciais e privacidade

A API administrativa é exclusiva do administrador e usa a proteção de sessão/CSRF existente. O token nunca é devolvido pelo GET nem incluído no estado enviado aos clientes. Depois de salvo, o campo fica vazio com indicação de credencial existente. Deixe-o vazio para conservar o token ao manter a mesma identidade; ao trocar integrador/URL/sessão, informe-o novamente.

O arquivo `whatsapp-private.json` fica no diretório privado `RADAR_DATA_DIR`, com permissão `0600` e escrita por substituição atômica. Padrões adicionais no `.gitignore` protegem o nome do arquivo e temporários. Não copie credenciais para o código, exemplos, documentação ou issues. Desabilitar preserva a configuração salva, mas interrompe novos envios e cancela pendentes desse canal.

O adaptador usa TLS para serviços públicos, permite HTTP apenas para destinos locais/privados explicitamente configurados, não segue redirecionamentos com a chave e não repassa corpos de erro do provedor aos logs. As requisições têm timeout de 12 segundos. Uma configuração alterada espera a operação em andamento terminar no processo local.

## Acrescentar outro integrador

Os adaptadores ficam em `backend/integrations/` e usam o contrato de `base.py`:

- `id`, `name` e catálogo `fields` com chave, rótulo, tipo, valor inicial e indicação `secret`;
- `help`, opcional, para instruções específicas;
- `normalize(values)`: valida e normaliza os campos, sem requisições externas;
- `check(values)`: retorna um estado seguro com `ready` e `status`, sem enviar mensagens;
- `send(values, phone, text)`: envia um texto para um número E.164 e retorna um identificador de aceitação;
- `IntegrationError` com mensagem segura e `uncertain=True` para falhas em que a mensagem possa ter sido aceita.

Registre a instância em `WHATSAPP_PROVIDERS`. A API de configurações e a tela montam os campos a partir desse catálogo, sem uma nova rota por fornecedor. Campos públicos entram na identidade da fila; credenciais ficam ocultas. O contrato atual usa campos textuais; fluxos adicionais de um fornecedor, como OAuth ou QR próprio, exigem extensão específica. A configuração atual escolhe um integrador ativo para o canal; não administra múltiplas instâncias simultâneas.

Há um teste com um segundo integrador fictício que verifica cadastro, campos distintos e ocultação de sua chave sem mudanças nas rotas administrativas.

## Contrato OpenWA consultado

Fonte: [documentação fornecida pelo usuário](https://zap.axqi.ai/api/docs), especificação **OpenWA API 0.8.10**, consultada em 16/10/2026.

- Autenticação `X-API-Key`.
- Verificação: `GET /api/sessions/{id}`; confere o ID retornado e o estado documentado.
- Texto: `POST /api/sessions/{sessionId}/messages/send-text` com `chatId` no formato `numero@c.us` e `text`.
- Aceitação: HTTP 201 com `messageId`; armazenado como referência do provedor.

## Validação desta entrega

173 testes Python, 11 verificações frontend e build TypeScript/Vite. Incluem autorização, CSRF, arquivo privado, ausência de token nas respostas, validação de URL, troca de identidade, extensão por outro provedor, verificação/teste com limites, contatos deduplicados, filas independentes, falha parcial, expiração, pausa, silêncio, reinício, HTTP/timeout/redirect e IDs de aceitação. Todos os transportes dos testes são simulados, com bancos/contas temporários.

Nenhuma sessão real foi consultada com credenciais e nenhuma mensagem real foi enviada durante o desenvolvimento. A confirmação operacional depende de configurar a conexão e executar a verificação/teste pela interface. A conferência visual interativa continua pendente pelo bloqueio do navegador previamente registrado. O ambiente atual continua local, com um processo do servidor.
