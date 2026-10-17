# WhatsApp

## Configuração OpenWA

Em **Administração → Canais → WhatsApp**:

1. Selecione **OpenWA** e informe URL base, ID da sessão e token/API key. Use a raiz do serviço, sem `/api` ou `/api/docs`.
2. Habilite o canal, salve e clique em **Verificar sessão**. Se necessário, autentique a sessão no painel do integrador.
3. Para testar o envio, informe um número na seção de teste e confirme a ação. Consulte o resultado em **Administração → Envios**.

Verificar sessão não envia mensagem nem altera a sessão do integrador. O teste tem limite de uma solicitação por minuto; a verificação, uma a cada dez segundos.

Ative **WhatsApp** nas configurações de alerta de cada monitoramento. Os destinatários vêm do perfil: telefone de acesso ou alternativo, mais os números adicionais. O servidor normaliza e deduplica os números. A configuração não envia alertas antigos retroativamente.

## Processamento e credenciais

A fila tem tentativas independentes por destinatário e trabalhador separado do e-mail. Antes do envio, confere monitoramento, versão dos filtros, contatos, horário de silêncio e integração ativa. Alertas com mais de 30 minutos não são enviados.

Trocar a identidade da integração, desativá-la ou removê-la (`DELETE /api/admin/whatsapp`, que também apaga o segredo das confirmações) cancela mensagens pendentes. Operações em andamento não podem ser retiradas. Salvar e remover a integração e trocar o segredo das confirmações ficam na auditoria com os nomes dos campos alterados, sem valores. Timeout e resultado ambíguo não geram reenvio automático. **Aceito pelo provedor** registra a aceitação do pedido. Entrega e leitura dependem das confirmações descritas abaixo.

O token fica em `whatsapp-private.json`, no diretório privado, com modo 0600; não é devolvido pela API. Campo vazio preserva a credencial da mesma URL/sessão/integrador. Ao trocar essa identidade, informe a credencial novamente.

## Novos integradores

Implemente o contrato de [`base.py`](../backend/integrations/base.py) e registre o adaptador em `WHATSAPP_PROVIDERS`:

| Elemento | Responsabilidade |
|---|---|
| `id`, `name`, `fields` | Identificação e campos de configuração; credenciais usam `secret` |
| `normalize(values)` | Validar configuração sem acessar a rede |
| `check(values)` | Consultar disponibilidade sem enviar mensagens |
| `send(values, phone, text)` | Enviar texto para número E.164 e retornar ID de aceitação |
| `IntegrationError` | Erro seguro; `uncertain=True` indica possível aceitação |

A interface usa o catálogo de campos. O canal mantém um integrador ativo; fluxos próprios de OAuth ou QR exigem extensão específica.

O [adaptador OpenWA](../backend/integrations/openwa.py) usa `X-API-Key`, consulta `GET /api/sessions/{id}` e envia texto por `POST /api/sessions/{sessionId}/messages/send-text`. A aceitação exige HTTP 201 com `messageId`. Valide a compatibilidade com a versão do serviço instalado.


## Confirmações de entrega e leitura

O Radar recebe os eventos `message.ack` e `message.failed` do OpenWA. O retorno HTTP do envio continua separado da confirmação posterior: uma falha de entrega não reenfileira a mensagem.

Para ativar em produção:

1. Em **Administração → Canais → WhatsApp → Confirmações de entrega e leitura**, habilite o receptor e informe um segredo exclusivo de 32 a 255 caracteres, sem espaços. Salve.
2. Copie a **URL do webhook** exibida. Ela usa o domínio HTTPS configurado da instalação e o caminho `/api/webhooks/whatsapp/openwa`.
3. No OpenWA, cadastre um webhook na mesma sessão usada pelo Radar, com essa URL, os eventos `message.ack` e `message.failed` e o mesmo segredo no campo `secret`.
4. Valide com um destinatário controlado. Consulte a confirmação em **Envios** e nos detalhes de cada mensagem.

O cadastro do webhook no OpenWA é uma etapa explícita de ativação; salvar o receptor no Radar não altera o serviço externo nem envia mensagens.

O receptor verifica `X-OpenWA-Signature` sobre os bytes originais do corpo, usando HMAC-SHA256. Não usa cookie nem token do navegador. As demais rotas mantêm sua autenticação. O segredo fica em `whatsapp-receipts-private.json`, no diretório de dados, com modo 0600; os scripts existentes de backup e restauração incluem esse arquivo.

A assinatura é vinculada à integração e à sessão salvas. Alterar URL, sessão ou integrador exige informar novamente o segredo. Nenhuma configuração é cadastrada automaticamente em outro provedor.

| Estado | Significado |
| --- | --- |
| Aceito | A API aceitou o envio. |
| Enviado | O integrador confirmou `sent`. |
| Entregue | O integrador confirmou `delivered`. |
| Lido | O integrador confirmou `read`. |
| Falha de entrega | O integrador confirmou `failed`. |

As confirmações são registradas por destinatário. Mensagens lidas contam também como entregues. O horário apresentado é o do evento de confirmação informado pelo integrador; não é uma garantia do instante exato da leitura. Se apenas a leitura chegar, o sistema não inventa um horário anterior de entrega.

Confirmações repetidas não duplicam registros, e eventos atrasados não fazem uma mensagem lida voltar para enviada. Uma caixa de entrada temporária conserva confirmações que chegam enquanto o pedido de envio ainda está em andamento; esses registros têm limite de tamanho e validade de uma hora. As confirmações finais acompanham a retenção do envio.

Ausência de confirmação não comprova falta de entrega ou leitura. Os registros anteriores permanecem aceitos até receberem um evento verificável; esta versão não consulta conversas para reconstruir o histórico. Se o Radar ficar indisponível além das retentativas do webhook, a confirmação pode não ser recebida.

No desenvolvimento em `127.0.0.1`, use eventos simulados e assinados. O OpenWA externo precisa alcançar a URL HTTPS de produção para enviar confirmações reais.
