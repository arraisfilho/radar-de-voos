# Regras do produto

## Monitoramento

Uma busca define origem/destino, ida ou ida e volta, janelas de saída, passageiros, cabine, moeda e preferências por trecho. Pode ser pausada, retomada, encerrada, restaurada ou excluída. O encerramento automático ocorre ao fim da última janela de partida.

O limite padrão é cinco buscas por conta, ajustável pelo administrador. Há limites de três aeroportos por lado, sete datas por janela e 24 combinações aeroporto/data por ciclo. A coleta é periódica, não uma assinatura de eventos das companhias.

## Filtros

- Aeroportos internacionais, pesquisáveis por cidade, nome ou código IATA.
- Janelas de data e horário, inclusive atravessando a meia-noite.
- Adultos, crianças e bebês, com ou sem assento, conforme categorias aceitas pela fonte.
- Cabine e moeda da consulta; a sugestão inicial considera idioma/região e fuso do dispositivo.
- Voo direto, uma escala ou duas ou mais, selecionáveis por trecho.
- Duração total, chegada limite, espera por conexão e companhias por nome ou código.
- Inclusão de taxas estimadas para bagagem despachada.

Horários de saída seguem o aeroporto de origem; limites de chegada seguem o destino. Duração inclui conexões. Sem limite de duração, o filtro não exclui viagens longas; quando ativado, o controle permite até 48 horas. A seleção de bagagem não confirma franquia, peso ou dimensões da tarifa.

## Preços e histórico

O preço representa o grupo de passageiros por trecho, na moeda selecionada. A soma dos menores preços de ida e volta é uma estimativa de bilhetes separados, não uma oferta conjunta confirmada.

O histórico do usuário privilegia variações e gráficos distintos por direção. Coletas e diagnósticos técnicos ficam separados da apresentação principal. Resultados reaproveitados conservam o horário original.

## Alertas

Oportunidades são avaliadas com os filtros salvos. A referência é o menor preço válido da mesma janela e versão; a opção pode mudar de voo, companhia ou aeroporto. Alterações de cobertura não devem ser apresentadas como queda de mercado.

- Meta atingida pode gerar evento na primeira coleta, sem economia anterior inventada.
- Comparações exigem coleta completa da direção.
- Eventos iguais são deduplicados, com silêncio mínimo e supressão de oportunidades repetidas.
- O aviso apresenta trecho/data, preço anterior e atual quando comparáveis, economia e link para conferir a pesquisa.
- E-mail e WhatsApp dependem da configuração administrativa e dos contatos do perfil.

## Limites e evolução

A fonte pode não retornar todas as opções existentes. Preço observado, bagagem e disponibilidade exigem confirmação antes da compra. Formato e limites da fonte são dependências externas.

O piloto usa uma instância e SQLite. Escala horizontal exige coordenação de agendamento, fila externa e persistência apropriada. Telegram, verificação de contatos, MFA administrativo e confirmações de entrega são evoluções pendentes.
