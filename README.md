# Radar de Voos

Instalação em containers e na nuvem: **[passo a passo em docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. O projeto publica somente a porta da aplicação; use seu proxy reverso existente. Veja também [revisão de segurança e limites](docs/SECURITY_REVIEW.md).


Aplicação local para acompanhar tarifas que atendem às regras de uma viagem. Interface em React/TypeScript, visual claro e responsivo, serviço Python com FastAPI, persistência SQLite e filas de alertas por e-mail (Google/SMTP) e WhatsApp.

**Estado:** piloto com contas de usuário e administrador. Modos local e container público com HTTPS via proxy externo. O repositório não foi publicado.

## O que está implementado

- Cadastro/login com telefone internacional e senha, sessões e isolamento de buscas por conta.
- Perfil com até quatro e-mails e escolha do telefone de acesso ou outro número para WhatsApp.
- Administração em abas: usuários, envios paginados por canal/usuário/período, contas de envio, auditoria e retenção.
- Cadastro manual, edição de contatos/preferências e redefinição de senha com revogação das sessões da conta.
- Até quatro telefones adicionais, disponíveis no cadastro administrativo e no perfil do cliente.
- Detalhes do conteúdo enviado, com recuperação de acesso protegida; registros concluídos retidos por 90 dias por padrão e limpeza manual com prévia.
- Administração exclusiva de SMTP/Google e WhatsApp, separada do perfil e dos contatos dos usuários.
- WhatsApp com catálogo de integradores, adaptador OpenWA, contatos deduplicados, fila independente e resultados por destinatário.

- Criar, editar, pausar, retomar, arquivar e restaurar buscas, preservando o histórico.
- Selecionar múltiplos aeroportos de origem e destino no catálogo mundial com 7.884 códigos IATA e fusos horários.
- Cadastrar buscas em três etapas: viagem, preferências e alertas.
- Configurar janelas de saída com barra de dois seletores e campos de data/hora, incluindo a passagem pela meia-noite.
- Ajustar duração e espera com barras e campos numéricos; coletas automáticas a cada cinco minutos.
- Solicitar taxas estimadas de bagagem despachada no preço pesquisado.
- Filtrar quantidade de escalas, duração total, limite de chegada, espera máxima por conexão e companhias.
- Configurar ida e volta independentemente, adultos/crianças/bebês, cabine, meta e queda mínima de preço.
- Cadastro guiado da ida à volta, com nome opcional sugerido na confirmação final.
- Acompanhar o contador da próxima consulta, andamento por trecho e erros de coleta.
- Consultar tarifas reais do Google Flights por fast-flights 3.1.0 com adaptação local para ler dois grupos da resposta.
- Guardar coletas, menores preços, versões de filtros, referências e alertas no SQLite.
- Mostrar histórico de preços e exportar os dados da busca em JSON sem configurações SMTP.
- Configurar SMTP com STARTTLS ou TLS direto, salvar a senha localmente e solicitar um e-mail de teste.
- Agrupar eventos da mesma busca/ciclo na fila de e-mail e registrar aceitação pelo servidor SMTP, falha ou cancelamento.

O agendador funciona com o navegador fechado, **enquanto o processo do servidor e o computador estiverem ligados**. Isto ainda não é uma hospedagem permanente 24 horas.

## Início rápido

Requisitos: Python 3.12 e Node.js 22.12 ou superior na linha 22 (ou versão compatível com Vite 7). Execute a partir da raiz deste projeto:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
cd frontend
npm ci
npm run build
cd ..
.venv/bin/python scripts/run.py
```

Abra **http://127.0.0.1:8765/**. Na tela de acesso, use **Configurar o primeiro administrador neste Mac** para criar sua conta administrativa. Não há senha padrão. Se o telefone já tiver uma conta, use a senha existente. As buscas anteriores são preservadas e vinculadas a essa primeira conta administradora. Não abra `frontend/index.html` diretamente como arquivo; a interface precisa da API no mesmo endereço.

O primeiro início cria uma busca com THE → GRU/CGH entre 05/11/2026 22:00 e 06/11/2026 06:00, e volta em 09/11/2026. Após esse período, uma nova instalação escolhe datas futuras para a busca inicial. A busca inicial usa um adulto, econômica, até uma escala e oito horas por trecho. Nenhum preço de exemplo é carregado como se fosse resultado real.

O intervalo entre coletas é fixo em cinco minutos no servidor, sem disparo manual. A fila global limita o início das consultas e pode prolongar o tempo efetivo em períodos de carga. Há limites de cinco buscas, três aeroportos por lado, até sete datas por janela e 24 combinações aeroporto/data por ciclo para esta versão de teste.

### Ambiente já preparado nesta conversa

O processo de teste foi iniciado com um ambiente Python existente e dados fora da pasta do projeto. Para reproduzir esta instalação específica:

```sh
RADAR_DATA_DIR=/caminho/privado/radar-app-data .venv/bin/python scripts/run.py
```

Não inicie duas instâncias sobre o mesmo diretório de dados. O serviço não implementa eleição de líder para múltiplos processos.

### Teste no celular pela rede local

O modo LAN exige habilitação explícita:

```sh
RADAR_HOST=0.0.0.0 RADAR_LAN_CIDR=192.168.3.0/24 RADAR_DATA_DIR=/caminho/privado/radar-app-data .venv/bin/python scripts/run.py
```

Nesta instalação, abra **http://192.168.3.42:8765/** no celular conectado ao mesmo Wi-Fi. O endereço é o IP atual do Mac e pode mudar no DHCP. Mantenha o Mac e o servidor ligados. O firewall do macOS e o isolamento de clientes do roteador precisam permitir a conexão.

A API verifica IP de origem, Host, Origin e token das alterações. Apenas loopback e `192.168.3.0/24` são autorizados neste modo. Cada pessoa entra na própria conta. A criação inicial do administrador é permitida somente pelo acesso de loopback neste Mac; depois ele pode entrar normalmente pela rede autorizada. Senhas SMTP continuam sem ser devolvidas pela API. Não configurar redirecionamento público de portas.

### Desenvolvimento da interface

Com a API funcionando em 8765, execute `npm run dev` dentro de `frontend/`. O Vite encaminha `/api` para o backend. Após alterações, gere novamente `npm run build` para atualizar a versão servida pelo Python. Recarregue a página ao usar esse build.

## Cadastro e contatos

O usuário cria uma conta escolhendo o país (bandeira/DDI), informando DDD e número, nome e senha de pelo menos dez caracteres. O telefone é normalizado em E.164 e usado para login. O número ainda não é confirmado por SMS/WhatsApp.

Em **Meu perfil**, o usuário cadastra até quatro e-mails válidos e escolhe se o contato de WhatsApp será o telefone de acesso ou outro número internacional. Não há servidor de envio no formulário do usuário. WhatsApp pode enviar alertas quando o administrador configurar e habilitar a integração e o usuário selecionar o canal na busca. Telegram permanece indisponível; salvar o contato não ativa envio.

Cada usuário vê e altera apenas suas buscas, resultados, históricos e exportações. O administrador configura o transporte de e-mail, mas os destinatários de alertas vêm do perfil do dono da busca.

## Conta Google (janela de autorização)

Em **Administração → Adicionar conta de e-mail**, informe o endereço e clique em **Continuar**. Gmail e Google Workspace são identificados e encaminhados ao login Google. Na distribuição preparada, o registro Google acompanha o aplicativo e quem instala não configura Google Cloud. O cliente Desktop já foi registrado e configurado nesta build, com público restrito à organização Workspace; o login e o envio reais ainda precisam ser validados. Os campos técnicos foram retirados da interface. A autorização abre uma janela do Google, sem senha SMTP. O transporte usa a API Gmail e renova o acesso em segundo plano. [Configuração e limites](docs/GOOGLE_MAIL.md).

## E-mail SMTP (alternativa manual)

Somente o administrador tem acesso a **Administração → E-mail por SMTP**:

1. Informe servidor, porta e segurança indicados pelo seu provedor.
2. Informe usuário e senha de aplicativo, quando exigidos.
3. Defina remetente e um e-mail para testes, habilite o envio e salve. O destinatário de testes não é usado como destino global dos alertas.
4. Use **Enviar e-mail de teste** e acompanhe o resultado em Atividade de envio.

A senha nunca é devolvida pela API e é salva em `smtp-private.json` com permissão de arquivo `0600`, dentro do diretório de dados. Uma senha vazia no formulário preserva a anterior; mudar servidor ou usuário exige informar novamente a senha. O navegador não mantém a senha após o salvamento.

Nenhuma credencial real foi incluída no código. A validação automatizada usa transportes simulados e não envia e-mails externos; o teste na interface usa a configuração fornecida pelo administrador.

“Aceito pelo servidor SMTP” confirma aceitação da mensagem pelo servidor, não entrega ou leitura na caixa de entrada. Falhas ambíguas não são reenviadas automaticamente para evitar duplicação. Alertas anteriores à configuração do SMTP não são enviados retroativamente. Uma mensagem que já estiver em trânsito não pode ser retirada ao pausar a busca.

## Regras de preço e alertas

- Todas as condições salvas são aplicadas no servidor antes de calcular o menor preço e o alerta.
- A janela de saída usa horário local de cada origem. O limite de chegada usa o destino. A duração é calculada com instantes UTC, incluindo conexões.
- “2 ou mais” é uma categoria de escalas, não o limite de duas. Selecionar apenas “1 escala” exclui voos sem escalas.
- O preço da consulta representa o grupo de adultos, por trecho, na moeda BRL. A interface identifica esse escopo. Para dois adultos, por exemplo, não o apresenta como preço individual.
- A soma dos menores trechos é uma estimativa de bilhetes separados; não é uma oferta conjunta confirmada. Aeroportos diferentes na ida e na volta são destacados.
- Alterar filtros cria uma nova versão e uma nova referência, sem interpretar mudanças de cobertura como queda de mercado.
- Um alerta pode ocorrer na primeira consulta se a meta já for atingida. Nesse caso não é inventada uma economia anterior.
- Comparações de menor preço podem mudar voo, companhia e aeroporto. Os textos dos alertas explicitam essa referência.
- Ciclos parciais não produzem comparações de preço para a direção afetada. Últimos preços válidos podem continuar na tela, identificados como antigos.
- A referência usa o último menor preço válido da mesma janela/versão. Eventos iguais são deduplicados. Há silêncio mínimo de dez minutos entre eventos por direção e supressão de oportunidades iguais ou piores durante duas horas; o mesmo preço/motivo não gera novo evento na mesma versão.

## Estrutura para o futuro repositório privado

```text
backend/                 API, regras de busca, coletor, banco, filas e integradores
frontend/src/            Interface React, tipos e componentes
frontend/package-lock.json
tests/                   Regras, persistência, API e privacidade de credenciais
scripts/run.py           Inicialização local
docs/                    Arquitetura e validação
.github/workflows/       Verificações para uso após futura publicação
.env.example             Exemplo sem segredos; não é carregado automaticamente
requirements.lock        Dependências Python exatas do ambiente validado
```

Por padrão, os dados são salvos em `.data/`, ignorada pelo Git. `RADAR_DATA_DIR` permite usar outra pasta privada. Também ficam ignorados `.env`, senhas SMTP, bancos, logs, `.venv`, `node_modules` e builds. As variáveis de `.env.example` são referências: exporte-as no terminal ou use o gerenciador de ambiente de sua preferência.

**Não foi criado repositório remoto, feito commit ou push.** Quando autorizada a publicação, criar o repositório como privado no GitHub e conferir os arquivos selecionados antes do primeiro envio. O arquivo de workflow só será executado pelo GitHub após uma publicação futura; os testes desta entrega foram executados localmente.

## Testes

```sh
.venv/bin/python -m unittest discover -s tests -v
cd frontend
npm run build
```

Os testes automatizados não consultam tarifas nem enviam mensagens reais. Usam arquivos e banco temporários. Consulte `docs/VALIDATION.md` para a evidência da execução real.

## Limites desta versão

- Há autenticação e isolamento por conta no ambiente local. O acesso padrão é somente neste computador. O modo LAN opcional aceita apenas a sub-rede privada configurada e não deve ser publicado na Internet nesta forma.
- O catálogo mundial usa códigos IATA; a presença no catálogo não garante inventário na fonte para toda rota/data. Aeródromos sem código IATA não são pesquisáveis por este coletor.
- O coletor aceita solicitar taxas estimadas de zero, uma ou duas malas despachadas. Não confirma franquia, peso ou dimensões por tarifa. Reembolso, autotransferência e troca de aeroporto durante a conexão também não são confirmados.
- Os links abrem a pesquisa da rota/data, sem garantir reserva daquela oferta.
- O scraper pode mudar, falhar ou retornar apenas parte do inventário. Não há garantia de menor preço absoluto, detecção instantânea ou estabilidade de produção.
- Verificação dos contatos, publicação em nuvem, canal Telegram, calendário flexível amplo, combinação de bilhetes e cálculo de traslado são evoluções posteriores.
- O build e a API foram validados. A inspeção visual automatizada depende de liberar a origem local nas permissões do navegador.


Detalhes dos contratos e limites das contas: [docs/ACCOUNTS.md](docs/ACCOUNTS.md). A autenticação está em teste local sobre HTTP; antes de hospedagem pública serão necessários HTTPS/cookies seguros, confirmação de contatos e recuperação de acesso.

O painel da conta Google permite informar um **E-mail para teste**, salvo ao solicitar o envio e reutilizado nos próximos testes. A confirmação e a atividade mostram o destinatário. Esse endereço administrativo não altera os contatos dos alertas.

## Moedas, duração e ciclo do monitoramento (0.6)

A busca permite escolher uma das 71 moedas declaradas pelo fast-flights instalado. Novas buscas sugerem a moeda pela região/idioma e fuso do navegador, com país do perfil como alternativa, sem geolocalização ou serviço IP externo. A escolha manual permanece na busca. A moeda vai para a consulta e para o link da fonte; painel, histórico e alertas usam a mesma unidade. Não há conversão cambial interna. A companhia/vendedor define a moeda efetiva de pagamento.

Mudar a moeda limpa a meta e redefine a queda mínima para 50 unidades antes de salvar; salvar os filtros inicia uma nova referência. Buscas antigas permanecem em BRL. Valores internos continuam em centésimos da unidade escolhida; a interface formata a moeda pelo código.

Duração total e limite de conexão têm barra e campos de horas/minutos, com precisão de um minuto nos campos. O intervalo entre coletas é fixo em cinco minutos. A frequência dos voos não define a precisão do filtro de duração.

O monitoramento encerra no fim da última janela de partida (volta, quando houver), respeitando os fusos dos aeroportos de origem. Dias encerrados deixam de ser consultados; a volta pode continuar depois da ida. O painel mostra a data limite. Pausar interrompe novas coletas; arquivar preserva o histórico; excluir pede confirmação e remove busca e dados relacionados do banco em uso. E-mails já enviados e cópias de segurança não são apagados. Uma coleta externa já iniciada pode terminar, mas seus dados não recriam uma busca excluída.

Meu perfil apresenta telefone de acesso, até quatro e-mails, contato de WhatsApp e usuário Telegram opcional. O telefone de acesso permanece protegido contra edição neste formulário; pode-se escolher outro telefone de contato para WhatsApp. Salvar Telegram não prova posse nem ativa envio: uma futura integração precisará vincular a conta ao bot. Usuários comuns não recebem dados de administração ou de outras contas.

Na revisão 0.6.1, cadastro/login e contato alternativo de WhatsApp usam formatação progressiva por país, exemplos nacionais e colagem com +DDI. A troca de país preserva os dígitos digitados para revisão. A máscara não comprova existência ou posse do número; a validação definitiva do formato continua no servidor. O contato alternativo pode mudar sem alterar o telefone de login.

## Revisão 0.7

Identidade e saída visíveis, lista compacta de monitoramentos com pausa/retomada/encerramento, histórico de buscas encerradas com retorno ao monitoramento, gráfico monetário de toda a série e alertas concisos. Português/inglês/espanhol com detecção do dispositivo e escolha manual. Auditoria de acessos com IP direto e navegador/sistema declarado, sem credenciais. A auditoria pessoal fica no perfil; a visão global é administrativa. Consulte [revisão e próximos passos](docs/REVISAO_0.7.md).

Ao retornar uma busca encerrada com prazo futuro, a coleta é retomada. Se o prazo passou, use Reutilizar com novas datas. A exclusão definitiva continua separada e exige confirmação.

Testes de interface sem navegador: `node tests/frontend_i18n.cjs`, `node tests/frontend_locale.cjs` e `node tests/frontend_phone.cjs`, após instalar as dependências frontend.

## Revisão 0.8

Linhas de voos compactas com logomarcas e detalhes expansíveis, resumo adaptado a somente ida e histórico apenas com primeiro preço e variações. Cadência fixa de cinco minutos, sem Buscar agora, com fila global e uma consulta simultânea por conta. Recuperação de senha pelo primeiro e-mail salvo e horário silencioso no perfil. Consulte [a revisão e os limites](docs/REVISAO_0.8.md).

## Revisão 0.9

Visão detalhada apenas da busca selecionada, status integrado ao resumo, métricas menores, logos separadas em grade e prévia local dos filtros sem novas consultas à fonte. Edição por abas compactas, rascunhos por busca durante a sessão e barra Salvar/Descartar. Resultados em lotes de 40, relógio isolado e polling adaptativo. Consulte [a revisão e os limites da prévia](docs/REVISAO_0.9.md).

## Revisão 0.10

Página inicial com convite ao primeiro monitoramento ou cartões das viagens da conta. Histórico geral de avisos, inclusive de buscas encerradas, separado de altas/quedas observadas. Perfil compacto e histórico com controles agrupados. Polling condicional por revisão da conta, dados carregados por área e retenção conservadora de respostas brutas antigas (30 dias por padrão), preservando preços/alertas e respostas de recuperação. Consulte [a revisão completa](docs/REVISAO_0.10.md).

Verificação da home sem navegador: `node tests/frontend_home.cjs`. Não há screenshots nem inspeção visual da sessão bloqueada.

## Revisão 0.11

Preferências de busca compactas, com duas colunas no desktop, uma no celular, opções adicionais recolhidas e ações fixadas no fim da janela com rolagem interna. Busca de companhia por nome ou código, sugestões e seleção múltipla em etiquetas; catálogo internacional embarcado, sem consultas de tarifas durante a digitação. Consulte [a revisão](docs/REVISAO_0.11.md) e [a origem do catálogo](config/README.md).

Consulte [a revisão da administração 0.12](docs/REVISAO_0.12.md) para filtros, identificação do serviço de envio e limites da retenção.

Consulte [a revisão 0.13](docs/REVISAO_0.13.md) para cadastros administrativos e retenção configurável de logs de envio e acesso.

Consulte [a revisão 0.14](docs/REVISAO_0.14.md) para passageiros, início do monitoramento e fluxo de ida/volta.

Consulte [a revisão 0.15](docs/REVISAO_0.15.md) para filtros horizontais, configuração visível de alertas e levantamento da API OpenWA.

Consulte [a integração WhatsApp](docs/WHATSAPP.md) para configurar a OpenWA e adicionar novos integradores.
