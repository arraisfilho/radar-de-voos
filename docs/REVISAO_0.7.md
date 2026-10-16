# Revisão 0.7 — navegação, idiomas, auditoria e alertas

Revisão independente por subagente, somente leitura, seguida das correções e testes descritos abaixo. Nenhum dado de usuário real foi criado ou excluído para os testes. Nada publicado no GitHub.

## Resultado dos pedidos

| Pedido | Implementação |
|---|---|
| Conta e logout | Nome e telefone de login na lateral e no cabeçalho móvel; saída visível. Logout renova o token antes de revogar a sessão, evitando falha após reinício do servidor. |
| Monitoramentos | Lista compacta com estado e ações de pausar, retomar e encerrar. Encerrados saem da lateral e ficam no Histórico. Retorno imediato para datas válidas; reutilização com novas datas quando o prazo terminou. |
| Auditoria | Eventos de cadastro, login correto/incorreto/limitado e logout, horário UTC persistido, IP da conexão, User-Agent limitado a 512 caracteres, navegador e sistema declarados. Usuário consulta os próprios eventos; administrador consulta o conjunto. |
| Lateral | Removido o subtítulo que quebrava a marca; identidade e saída agrupadas no rodapé. |
| Idiomas | Português, inglês e espanhol conforme o idioma preferido do navegador. Outros idiomas usam inglês. Seletor manual salvo neste navegador. Mensagens, formulários, textos acessíveis, datas e moedas localizados; preferência de idioma dos alertas salva na conta. Novas buscas e filtros salvos enviam o idioma ao provedor. |
| Espaço | Controles de monitoramento em linhas compactas, detalhes técnicos/auditoria recolhidos, seleção de histórico e gráfico sem duplicar a lista de arquivadas no perfil. |
| Alertas | Até sete linhas com rota/data, companhia, escalas/duração, preço anterior → atual, economia, chegada/passageiros/bagagem e link. Formato comum preparado para futuros canais. Somente e-mail envia hoje. |
| Gráfico | Série da vida completa do monitoramento, por versão dos filtros; linhas distintas de ida/volta, eixo monetário, escolha de trecho, toque e seletor por teclado. Leitura de encerradas sem reativar. Exportação inclui todos os snapshots. |

A detecção inicial usa o idioma preferido do dispositivo, não a localização física. Uma escolha manual prevalece neste navegador. Dados digitados pelo usuário, como nome da viagem, não são traduzidos automaticamente.

## Exemplo do novo alerta

Exemplo baseado nos valores fornecidos pelo usuário, não uma nova cotação:

```text
São Paulo · novembro · META ATINGIDA
IDA · 05/11 23:40 · THE → CGH
LATAM · 1 escala(s) · 7h50
R$ 2.815,00 → R$ 1.108,00
Economia: R$ 1.707,00 (61%)
Chegada: 06/11 07:30 · 1 adulto(s) · por trecho · bagagem a confirmar
Ver oferta: [link da pesquisa]
```

O valor anterior continua sendo a menor tarifa elegível da mesma busca/versão; não há promessa de comparação do mesmo voo. Essa semântica fica disponível no painel e no histórico. Alertas já enviados não são alterados. WhatsApp/Telegram ainda não estão integrados.

## Achados da revisão e correções

| Prioridade | Achado | Resultado |
|---|---|---|
| P2 | Logout usava token do primeiro carregamento, inválido após reinício. | Busca token atual antes da saída e apresenta falha de revogação, sem fingir sucesso. |
| P2 | Encerradas não abriam histórico/exportação. | Leitura e exportação do próprio usuário aceitam encerradas; mutações continuam separadas. |
| P2 | Gráfico limitado a 160 snapshots, sem eixo de valores e dependente de hover. | Endpoint de série completa, agregação em aproximadamente 240 intervalos por direção, moeda e interação por toque/teclado. |
| P2 | Deduplicação por preço impedia oportunidades repetidas permanentemente. | Unicidade por ciclo; cooldown existente preservado. Migração conserva os eventos antigos. |
| P2 | Controle de tentativas era temporário, não auditoria. | Tabela de eventos independente, com sucesso/falha/logout e visibilidade por papel. |
| P3 | Textos fixos, datas, moedas e alertas em português. | Catálogo central PT/EN/ES, testes de completude das chamadas de tradução e parâmetros. |
| P2 | Coleta global serial pode atrasar outros usuários em buscas lentas. | Pendente: dividir a fila em tarefas com limites globais e por usuário, com observabilidade do atraso. Não é resolvido apenas aumentando a frequência. |

## Auditoria e limites

- Retenção padrão de 90 dias, limitada a 20 mil eventos, com limpeza a cada novo evento. Configurável por `RADAR_AUDIT_RETENTION_DAYS` (1 a 3650).
- Usa o endereço do socket. O servidor local ignora cabeçalhos de proxy; futura hospedagem com proxy precisa definir explicitamente os intermediários confiáveis.
- Navegador/sistema são inferidos do User-Agent declarado. Não são identificação inequívoca da pessoa ou modelo exato do aparelho.
- Não registra senha, cookie de sessão, token OAuth, código de autorização ou cabeçalhos completos. Telefones exibidos na auditoria são o login da conta existente, não números arbitrários digitados em tentativas sem conta.
- A preferência de idioma da conta reflete o último dispositivo/seleção que a salvou. O idioma de cada busca é preservado até novo salvamento.

## Gráfico e histórico

Consultas de estado permanecem limitadas para não transferir a vida inteira da busca a cada três segundos. O gráfico tem endpoint separado, atualizado a cada trinta segundos, preservando toda a extensão temporal. Em grande volume, cada ponto representa o menor preço em seu intervalo, com o horário real do snapshot escolhido. Os filtros e moedas de versões diferentes não são misturados. A exportação preserva os dados completos.

## Próximas melhorias sugeridas

1. **Fila de coleta justa entre usuários:** concorrência limitada, prioridade e indicador do atraso real, sem sobrecarregar a fonte.
2. **Confirmação de contatos e recuperação de acesso:** antes de transformar o teste local em serviço público.
3. **Preferências de notificação:** horário silencioso no fuso do usuário, queda percentual e opção de resumir várias oportunidades em uma mensagem.
4. **Integrações reais de canais:** vinculação ao bot Telegram e configuração do provedor WhatsApp, com preferência e confirmação do destinatário.
5. **Validação visual e acessibilidade em dispositivos reais:** concluir testes de toque, zoom, teclado e idiomas em celulares/tablets. O agente ainda está impedido de observar a origem local por uma permissão salva do navegador.
