# Revisão 0.8 — aproveitamento de espaço e coletas controladas

## Interface e histórico

- As opções de voo apresentam companhia/logomarca, rota, horários, datas, duração, escalas, preço e acesso à passagem no mesmo conjunto compacto. No desktop os grupos dividem uma linha; em telas menores se reorganizam para manter o texto legível. Bagagem e conexões completas ficam em detalhes expansíveis.
- O preço representa o grupo de adultos por trecho, não um valor unitário por adulto.
- Busca somente de ida apresenta apenas o menor preço de ida. Menor volta e soma estimada aparecem quando há retorno.
- A tabela de histórico mostra o primeiro preço válido e cada variação posterior, por direção e versão dos filtros. Coletas sem alteração e falhas não viram novas linhas nessa tabela. Exibe até 160 variações recentes; a exportação preserva todas as coletas e o gráfico mantém sua série histórica com agrupamento para séries extensas.
- Campos de duração usam horas/minutos compactos, com barra. Categorias de escalas permanecem em uma linha. Janelas de saída continuam aceitando horários que atravessam a meia-noite.

## Logomarcas

O coletor associa nomes aos códigos das companhias presentes nos metadados da busca. O protótipo obtém PNGs em `https://www.gstatic.com/flights/airline_logos/70px/{codigo}.png`, por um endpoint autenticado do próprio backend. O navegador não precisa consultar o fornecedor diretamente.

Os arquivos ficam no diretório privado de dados. Cache positivo de sete dias e negativo de um dia, até mil arquivos, com limite de tamanho e validação do tipo/assinatura PNG. Quando não há código/imagem disponível, usa-se ícone de avião; o nome continua no desktop, no texto alternativo da imagem e nos detalhes do itinerário. Não há cobertura universal ou SLA garantido nessa origem, e o uso definitivo exige avaliar as condições do fornecedor.

Uma alternativa comercial documentada é [Airhex Airline Logos API](https://airhex.com/api/logos/), com pesquisa por códigos IATA/ICAO e licenciamento próprio. Nenhuma assinatura ou chave foi contratada/configurada. O adaptador de logos pode ser substituído antes da publicação.

## Cadência e fila

O servidor aceita somente `interval=300`. Buscas existentes são migradas sem apagar preços ou reiniciar referências. O usuário não escolhe a cadência nem possui botão Buscar agora; a ação antiga de refresh é rejeitada pela API. Editar filtros, pausar/retomar e restaurar não antecipam uma coleta para antes de `last_started + 300`.

Há no máximo dois ciclos de contas diferentes em andamento, uma consulta externa ativa por conta e cinco segundos entre inícios de consultas no conjunto do servidor. A admissão respeita a ordem da fila entre contas elegíveis. A próxima busca de cada conta também compete por ordem de vencimento. Uma consulta externa já iniciada pode terminar após pausa; consultas que aguardam na fila conferem novamente existência, versão e estado antes de acessar a fonte.

Cinco minutos é a cadência de referência, não uma garantia de que todos os resultados chegam nesse prazo. Filas, múltiplas combinações aeroporto/data e lentidão da fonte podem aumentar o tempo. Essa limitação local não comprova uma cota autorizada pelo Google nem evita todo bloqueio do provedor. Antes de escalar, medir volume e usar um fornecedor com contrato/cotas definidos.

## Recuperação e horário silencioso

“Esqueci minha senha” identifica a conta pelo telefone de acesso e envia ao primeiro e-mail salvo no perfil. A resposta é genérica, inclusive para conta inexistente, sem e-mail ou sem serviço disponível. Até cinco solicitações por IP/hora e cinco emissões por conta/hora. O link vale vinte minutos, usa token aleatório com hash no banco, é de uso único e não entra no caminho/query do servidor: fica no fragmento e é removido do endereço ao abrir o formulário.

Redefinir a senha revoga todas as sessões. Uma nova solicitação ou alteração dos e-mails invalida links anteriores e cancela mensagens ainda pendentes. Nenhum e-mail foi enviado pelos testes automatizados.

O endereço dos links é a origem canônica `RADAR_PUBLIC_URL`, configurada pelo responsável, nunca o cabeçalho Host recebido. Padrão: `http://127.0.0.1:8765`. Para validar pelo celular na rede atual, o processo usa `http://192.168.3.42:8765`; links dependem de o servidor estar acessível nesse endereço. Em hospedagem pública, configurar a origem HTTPS definitiva. Contas sem e-mail salvo dependem de recuperação administrativa futura; a versão local ainda não oferece verificação de posse de contato/telefone.

No perfil, o horário silencioso usa início, fim e fuso IANA, inclusive atravessando a meia-noite. Oportunidades continuam no painel, mas alertas silenciados não são enviados depois. Mensagens de recuperação/testes administrativos não são alertas de tarifa e não são silenciadas. O silêncio não interrompe a coleta nem reduz seu consumo de consultas.

## Validação

Testes com SQLite temporário, mocks de e-mail e download de logos: mudanças de preço por versão, exportação completa, cadência fixa, bloqueio de refresh, retomada sem antecipação, migração, fila/concor­rência/cancelamento, recuperação com expiração/uso único/revogação de sessões/invalidação por troca de e-mail, limites de solicitação, origem canônica, horário silencioso e cache de logomarcas. Traduções PT/EN/ES e compilação TypeScript/Vite verificadas separadamente.

A inspeção visual de desktop/celular permanece pendente: a política salva do navegador bloqueou a origem local em tentativas anteriores. Não foi usado outro caminho para contornar o bloqueio. Esta entrega não afirma que houve teste visual no navegador.

Nenhum commit, push ou publicação foi realizado. Credenciais, banco, tokens e cache ficam fora dos arquivos destinados ao GitHub.
