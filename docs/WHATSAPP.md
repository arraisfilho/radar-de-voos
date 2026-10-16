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

Trocar a identidade da integração ou desativá-la cancela mensagens pendentes. Operações em andamento não podem ser retiradas. Timeout e resultado ambíguo não geram reenvio automático. **Aceito pelo provedor** não comprova entrega ou leitura.

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
