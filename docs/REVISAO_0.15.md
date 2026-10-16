# Filtros rápidos e alertas visíveis — 0.15

A coluna lateral de filtros foi substituída por uma faixa horizontal antes dos resultados. Escalas, duração, companhia e bagagem ficam à vista, com distribuição em duas colunas no tablet e adaptação para celular. A lista de voos usa a largura disponível.

**Horários e conexões** reúne as opções adicionais em uma área inicialmente recolhida. Seu resumo mostra a janela do trecho e indica chegada limitada e tempo máximo de conexão quando definidos. Os ajustes continuam trabalhando com a prévia local e a barra de alterações pendentes; a busca na fonte continua no intervalo fixo do serviço.

## Configuração dos alertas

Um resumo **Alertas desta busca**, acima dos filtros/resultados, mostra canal selecionado, meta e queda mínima. O botão **Configurar alertas** abre um diálogo dedicado, com moeda, meta, queda mínima, contatos e seleção dos canais disponíveis. A explicação longa de moeda/preços fica recolhida. O último alerta observado continua abaixo da lista de voos, com acesso ao histórico completo.

Na criação de um monitoramento, os alertas continuam na etapa final. Os valores são apresentados como total do grupo por trecho, incluindo crianças/bebês quando selecionados.

Os rascunhos continuam compartilhados com a edição da busca. Se já houver alterações pendentes ao abrir os alertas, um aviso informa que salvar também aplicará essas alterações. Fechar a janela preserva o rascunho; não aplica configurações silenciosamente. Salvar usa o versionamento existente do monitoramento.

## WhatsApp: documentação consultada, integração seguinte

Fonte fornecida pelo usuário: [Swagger OpenWA](https://zap.axqi.ai/api/docs), consultada em 16/10/2026. A especificação servida pelo Swagger identifica **OpenWA API 0.8.10**.

- Autenticação global documentada: cabeçalho `X-API-Key`.
- Texto: `POST /api/sessions/{sessionId}/messages/send-text`.
- Corpo obrigatório: `chatId` e `text`.
- Conversa individual: formato documentado `phone@c.us`.
- Resposta documentada: HTTP 201 com `MessageResponseDto`; 400 para sessão inativa/requisição inválida e 404 para sessão inexistente.

Somente a documentação pública foi acessada. Nenhuma chave, sessão privada ou conversa foi consultada; nenhuma mensagem foi enviada. O canal WhatsApp permanece indisponível no produto até implementar a integração.

A próxima etapa deverá adicionar configuração exclusiva do administrador (origem do serviço, sessão e chave guardada localmente), validar a sessão, enfileirar mensagens por destinatário/canal, deduplicar os números de perfil e registrar a resposta do provedor. Um resultado ambíguo não deve gerar reenvio cego; aceitação não deve ser rotulada como entrega ou leitura. Credenciais não pertencem ao frontend, ao Git ou ao histórico de mensagens.

## Validação

Dez verificações frontend e compilação TypeScript/Vite aprovadas. Novos cenários verificam a ausência dos alertas nos filtros rápidos, um único controle de bagagem, isolamento do formulário de alertas, destinatários preservados, preço por grupo e salvamento sem avançar o assistente de viagem. Não houve alteração funcional do backend nesta revisão; os 155 testes Python da revisão anterior permanecem como referência, sem alegar nova execução.

A inspeção visual interativa segue pendente pelo bloqueio de origem já documentado. O ajuste foi baseado na captura fornecida e na renderização isolada dos componentes.
