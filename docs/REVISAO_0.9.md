# Revisão 0.9 — busca selecionada, prévia e eficiência

## Implementado

A visão de busca não repete a lista de todos os monitoramentos. A navegação lateral e o seletor móvel continuam permitindo trocar de busca. O resumo da selecionada reúne rota, datas, editar, ao vivo, próxima/última atualização e pausa/retomada/encerramento. As métricas têm menos altura e espaçamento; somente ida continua exibindo um único preço.

As companhias ocupam células independentes de logomarcas, com espaçamento positivo. Até quatro aparecem em grade de duas colunas, sem margens negativas. No celular, a linha do voo reorganiza rota e preço/ação para respeitar a largura. O nome da companhia permanece acessível e nos detalhes.

Duração, escalas, chegada, espera por conexão, companhias e horários dentro das mesmas datas têm prévia imediata nos voos já coletados, sem consultar Google Flights. Restringir remove opções; ampliar recupera candidatos existentes. Métricas e contagem acompanham a prévia. A comparação e os alertas persistidos continuam usando os filtros salvos.

A prévia não inventa tarifas nem consulta todos os voos existentes: ela trabalha com as opções que a fonte já devolveu para aquelas combinações e a versão atual. Alterar aeroportos, datas, quantidade de adultos, cabine, moeda ou bagagem requer salvar e aguardar nova coleta; nesses casos o painel conserva os preços da busca salva e explica a diferença. Valores antigos por falha de atualização continuam identificados.

A barra âmbar fixa apresenta “Alterações pendentes · Salve para atualizar o monitoramento”, Salvar e Descartar. Ela entra suavemente uma vez, respeita movimento reduzido e não pisca continuamente. O formulário é validado antes de salvar. Ao remover todas as categorias de escalas, o editor abre Preferências no trecho correspondente e direciona o foco.

A edição usa abas compactas livremente acessíveis, com Salvar em qualquer aba, em vez de exigir avançar três etapas. O cadastro novo preserva a orientação em etapas mais curtas. No editor móvel, a contagem da prévia agrega ida e volta; Ver resultados fecha o editor e mantém os ajustes. Rascunhos de cada busca são mantidos na memória da página durante trocas de monitoramento e marcados com asterisco lateral; não são gravados no servidor até salvar. Fechar/recarregar a página com rascunhos dispara o aviso padrão do navegador. Eles não sobrevivem à recarga nem substituem uma versão atualizada no servidor.

## Recursos e dados

- Relógio de um segundo isolado no componente LiveStatus; ele não atualiza toda a árvore de voos.
- Cartões memoizados, com inscrição no idioma para não congelar traduções. Formatadores monetários reutilizados por moeda/idioma.
- Filtragem memoizada e lista progressiva: quarenta resultados iniciais e botão Mostrar mais, preservando contagem total e ordenação.
- Polling de estado: três segundos durante coleta, quinze com monitoramento ativo e trinta quando parado. Não executa periodicamente em aba oculta; requisições obsoletas podem ser canceladas por AbortSignal. Isso consulta apenas o backend local, não aciona coletas da fonte.
- Tabela histórica e ciclos não são calculados na resposta enxuta usada pela visão de busca. São carregados no Histórico ou Ao vivo. A tabela mantém primeiro preço e variações, e a exportação mantém o contrato anterior.
- `GET /api/state?preview_pool=true` devolve candidatos da coleta vigente, dentro do proprietário e versão, em vez de só elegíveis; `detail=false` omite histórico e ciclos. O comportamento padrão da API permanece filtrado pelos critérios salvos. Contagens diagnósticas por rota continuam refletindo os critérios salvos.
- Cache HTTP privado das logos passa a ser preservado pelo middleware. Dados pessoais, preços e demais endpoints continuam com no-store.

## Revisores e próximos passos

Dois subagentes fizeram revisão somente por código: IHC/acessibilidade e desempenho/dados. Os ajustes encontrados de validação ao salvar por abas e aviso de saída envolvendo rascunhos de outras buscas foram incorporados.

Sugestões para a próxima evolução: separar configurações/entregas/alertas do polling de tarifas, carregar dados por revisão/ciclo e, após medir a necessidade, adotar eventos de atualização. Definir política de retenção de resultados brutos antes de remover registros; não houve limpeza de dados nesta revisão. Para logos em escala, revisar o fornecedor/licenciamento e concorrência do cache. Não foi adicionada biblioteca de virtualização, WebSocket ou worker para a filtragem local de centenas de opções.

## Limite de validação

A ferramenta do navegador recusou novamente a origem local por permissão salva/gerenciada, mesmo com a solicitação do usuário. Não houve abertura de janela alternativa nem outro caminho para contornar a negativa. Não afirmamos inspeção visual ou teste em 320/375/768px e zoom de 200%. Os ajustes foram revisados em código, compilados e cobertos por testes de dados e lógica; a conferência visual no dispositivo permanece pendente.
