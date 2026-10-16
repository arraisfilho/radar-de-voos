# Revisão 0.11 — preferências compactas e companhia por nome

## Mudanças de usabilidade

A captura enviada mostrava a etapa Preferências com título e descrição repetidos, uma faixa apenas para Ida, duração apresentada duas vezes, campos empilhados com margens grandes e bagagem em cartão separado.

A janela de criar/editar busca agora usa título curto, navegação de etapas menor e limite de altura. No desktop, o conteúdo principal usa duas colunas; em telas estreitas, se reorganiza em uma coluna. Uma busca somente de ida não reserva uma linha para escolher o único trecho. A duração mantém barra e entrada de horas/minutos lado a lado, sem repetir o mesmo valor acima. O título explicativo da etapa continua acessível a leitores de tela, sem ocupar espaço visual.

Escalas, duração, companhia e bagagem ficam disponíveis de imediato. Chegada limite e espera por conexão ficam recolhidas em Chegada e conexões. Bagagem passa a ser um seletor com uma observação curta sobre taxas estimadas/franquia, preservando o significado do filtro. As ações de continuar/salvar ficam no rodapé aderente da janela; o conteúdo interno rola quando necessário, sem obrigar a janela a ocupar a página inteira.

Os ajustes são específicos do modal de busca, preservando os diálogos de exclusão e administração. O seletor de companhia também substitui o campo de códigos na filtragem lateral.

## Busca de companhias

O usuário pode digitar nome ou código — LATAM/LA, GOL/G3, Azul/AD, British Airways/BA, American Airlines/AA, entre outros. A seleção produz etiquetas removíveis com nome e sigla. Sem seleção, a companhia não é restringida. É possível selecionar mais de uma, até o limite já aceito de vinte por trecho, e limpar a seleção inteira.

Sugestões aparecem após dois caracteres, com atraso de 180 ms e cancelamento de requisições obsoletas. A busca acontece somente no backend local, sem consultar Google Flights. Uma seleção existente resolve seus nomes em um único lote; resultados já conhecidos são reutilizados no cliente. O navegador recebe no máximo doze sugestões, não o catálogo inteiro.

O campo tem semântica de combobox/listbox, seleção por Enter, navegação por setas, Escape para fechar sugestões, foco preservado e identificação acessível para remoção. Texto digitado que não foi selecionado impede avançar até escolher uma opção ou limpar o campo; não é silenciosamente convertido em ausência de filtro.

## Origem e limites do catálogo

São 1.112 códigos de referência únicos no arquivo local `config/airlines.json`. Fonte: [BesrourMS/Airlines](https://github.com/BesrourMS/Airlines), fixada no commit `76674119b8285ef38ebfe494e1c10394d1c120a5`, com licença Unlicense preservada no projeto. A transformação agrupa códigos válidos de dois caracteres e mantém nomes originais como aliases. Nomes de exibição de LA/G3/AD foram abreviados localmente. URLs de logomarcas e atributos comerciais do conjunto original não foram importados.

Este é um catálogo consultivo, com possíveis nomes históricos e sem comprovação de operação atual. A disponibilidade de uma companhia/rota depende da fonte de tarifas. Um código válido ausente pode ser escolhido explicitamente por Usar sigla informada, evitando limitar filtros ao catálogo embarcado. Não há promessa de cobertura universal ou atualização automática desse conjunto.

## Validação

Testes de nomes, códigos, aliases com acentos, ordenação, limites de resultados, códigos fora do catálogo, autorização e resolução em lote. O endpoint não aciona consultas de tarifa. Testes de componentes isolados verificam combobox, etiquetas, unidades da duração, bagagem, ausência da faixa Ida em buscas sem volta e fechamento inicial das opções adicionais. Compilação e catálogos PT/EN/ES verificados.

A análise visual desta revisão parte da captura enviada. Não houve inspeção da sessão do navegador bloqueada pela política já registrada; os testes de componentes usam dados fictícios e não substituem a conferência visual interativa em celular/desktop.
