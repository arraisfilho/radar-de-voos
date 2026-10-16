# Validação da aplicação local

## Revisão 0.7.0 — navegação e internacionalização

- 100 testes Python aprovados, três suítes frontend (idiomas/catálogos, moedas e telefone) aprovadas e build TypeScript/Vite concluído.

- Testes de auditoria com isolamento por usuário/admin, login correto/incorreto/logout, retenção e ausência de credenciais.
- Histórico/exportação de encerradas sem reativação; retorno ao monitoramento e leitura de séries longas por buckets, preservando o horário do mínimo.
- Migração da unicidade de alertas por ciclo, preservação de eventos e integridade referencial.
- Alertas curtos PT/EN/ES e callback Google no idioma da conta, com Google simulado.
- Testes frontend de idioma do dispositivo/fallback, troca manual, interpolação e completude dos catálogos, além de regressões de telefone e moeda.
- Revisão independente registrada em REVISAO_0.7.md. Inspeção visual em navegador/celular permanece pendente por restrição salva da origem local.

## Revisão 0.6.1 — formatação internacional

- Testes de formatação e 22 testes de contas aprovados; build TypeScript/Vite concluído. Servidor atualizado para 0.6.1.

- Testes de formatação BR/US/GB/CO, colagem internacional com seleção de país, DDI compartilhado, preservação dos dígitos ao trocar país, apagar delimitadores e posição do cursor ao editar. Executar `node tests/frontend_phone.cjs`.
- Campos com exemplos locais, teclado telefônico e indicação acessível de quantidade de dígitos incompatível ao sair do campo. A validação do servidor permanece responsável pelo formato persistido.
- Cadastro/login e contato de WhatsApp usam o mesmo componente. Alterar contato alternativo não altera login. Inspeção visual/manual permanece pendente por bloqueio da origem local para o agente.

## Revisão 0.6.0 — moedas e monitoramento

- 90 testes Python, oito cenários de sugestão de moeda e build TypeScript/Vite aprovados. Backup privado do SQLite anterior à migração preservado.

- Moedas: validação pelo catálogo do motor instalado, propagação a subprocesso/query/link, nova versão de referência ao alterar moeda e formato em alertas. Testes de consulta sem rede.
- Oito cenários de preferências do navegador: BRL, USD, EUR, COP, GBP, CHF e fallback de fuso. Sem localização precisa ou serviço externo. Executar `node tests/frontend_locale.cjs` após npm ci no frontend.
- Encerramento na data limite sem chamar coletor; continuação da volta após a ida; exclusão de datas já encerradas.
- Exclusão somente pelo dono, remoção do histórico relacionado, bloqueio durante envio e proteção contra resultados de coleta após exclusão. Nenhuma busca real foi excluída.
- Perfil Telegram normalizado e validado; contas comuns sem dados administrativos; contatos de alertas preservados. Testes usam contas temporárias.
- Inspeção visual em desktop/celular permanece pendente pela restrição salva de acesso do navegador local. Nenhum login real de usuário comum foi criado para os testes.

## Revisão 0.5.2 — destinatário de testes

- 78 testes automatizados e build TypeScript/Vite aprovados. Inspeção visual pendente pela restrição do navegador.

- Campo E-mail para teste no painel Google, com persistência local e confirmação do endereço solicitado. Histórico inclui destinatários salvos na fila.
- Endereços inválidos/injeção rejeitados antes de gravar ou enfileirar. Testes preservam remetente e contatos de alertas; acesso continua administrativo.
- Testes de envio simulados, sem novas mensagens externas nesta revisão.

## Revisão 0.5.1 — falha no retorno Google

- 76 testes aprovados e build TypeScript/Vite concluído. Mensagem segura de falha no postMessage e no estado administrativo; callback com fundo claro, link de retorno e CSP para estilo com nonce.
- Erros de credencial, código expirado, rede e resposta inválida traduzidos sem descrições brutas ou tokens; callback sem estado válido não altera diagnóstico persistido.
- Chave Desktop correspondente preservada no diretório privado, modo 0600, fora do Git. Mudança de ID/tipo não herda a chave anterior.
- Prova de protocolo com código fictício e sem conta de usuário: antes `invalid_request` exigindo client_secret; depois da configuração privada `invalid_grant` esperado para código inválido. Nenhuma mensagem externa enviada pelo diagnóstico.
- Login real após correção e inspeção visual permanecem pendentes; a permissão salva do navegador continua bloqueando a origem local para o agente.

## Revisão 0.5.0 — integração preparada na distribuição

- 70 testes automatizados aprovados; endpoints Google simulados, sem login ou envio externo.
- Distribuição Desktop com apenas identificador público; extração não copia segredos/tokens e rejeita cliente Web.
- Fluxo email → autorização, callback na raiz loopback, PKCE, renovação sem segredo por instalação e reconexão ao trocar o cliente distribuído.
- Campos técnicos removidos da interface. Build TypeScript/Vite aprovado.
- Cliente Desktop real criado e identificador público configurado em 16/10/2026; API Gmail ativada e três escopos declarados. Público Interno mantido. Teste interativo bloqueado para o agente por permissão salva da origem local; não há validação de login/envio real.
- Inspeção visual automatizada não realizada devido à restrição de acesso do navegador já registrada.

## Revisão 0.4.1 — adicionar conta pelo e-mail

- 65 testes automatizados aprovados. Oito novos testes cobrem identificação de Gmail/googlemail, MX Google Workspace atual/legado, domínio semelhante não confiável, timeout DNS, autorização com login_hint e ausência de login fictício quando faltam as credenciais do aplicativo.
- O domínio da conta SMTP já cadastrada foi consultado por DNS e identificado como Google, sem autenticação SMTP e sem envio de mensagem.
- Formulário principal: e-mail e Continuar. Configuração técnica em seção separada, recolhida, sem abertura automática dos campos OAuth.
- A autorização interativa real continua pendente do registro/configuração OAuth do aplicativo, sem reutilizar credenciais de outro cliente de e-mail.

## Revisão 0.4.0 — janela de autorização Google

- 57 testes automatizados aprovados. Os onze novos testes simulam os endpoints Google; não autenticam contas nem enviam e-mails externos.
- PKCE, estado de uso único, acesso offline, escopo de envio, callback sem exposição de tokens, cancelamento, expiração, saída da sessão e restrição administrativa.
- Arquivo de credenciais com modo 0600; segredo/tokens ausentes do estado público.
- Renovação de acesso e bloqueio sem fallback SMTP após revogação; MIME com remetente conectado e todos os destinatários da busca.
- Teste administrativo enfileirado para o e-mail Google conectado.
- Build TypeScript/Vite aprovado. A integração real e a inspeção da janela permanecem pendentes do cliente OAuth e da autorização do usuário.

## Revisão 0.3.0 — contas, contatos e administrador

- 46 testes automatizados aprovados, sem envio real de e-mails ou início de coletores pelos testes.
- Cadastro e unicidade de telefone E.164, exemplos de Brasil/EUA/Reino Unido, rejeição de número inválido e senha em Argon2id.
- Quatro e-mails permitidos, quinto rejeitado, normalização/deduplicação e rejeição de endereços inválidos.
- WhatsApp reaproveita o telefone de acesso ou salva outro número internacional. Nenhuma verificação de posse ou entrega presumida.
- Sessão, login/logout, limitação de tentativas incorretas, usuário comum sem leitura/alteração SMTP e sem acesso a buscas/exportações de outra conta.
- Configuração inicial administrativa bloqueada na LAN, criação inicial local e promoção de conta existente somente com sua senha. Buscas legadas assumidas pelo primeiro administrador.
- Fila usa até quatro e-mails do dono da busca; transporte recebe todos; destinatário administrativo de teste não é usado como fallback. Alterar contatos cancela mensagens ainda pendentes para os antigos.
- Servidor respondeu versão 0.3.0 em loopback e LAN. Estado privado sem login retornou 401. Configuração inicial disponível em loopback e indisponível na LAN na amostra de verificação. Nenhuma conta/senha administrativa foi criada automaticamente.
- Backup privado do SQLite anterior à migração preservado fora do repositório. Configurações SMTP existentes preservadas.
- Build aprovado, com carregamento do painel após autenticação. A inspeção visual automatizada continua pendente pela restrição do navegador já registrada.

## Revisão 0.2.0 — 16/10/2026

- 32 testes automatizados aprovados: inclui catálogo internacional, priorização de cidade, normalização de acentos, fusos com horário de verão e linha de data, companhias internacionais, migração de configurações, bagagem na consulta/link/subprocesso e restrição LAN. Os testes não iniciam o coletor nem enviam mensagens.
- Build TypeScript/Vite aprovado; JavaScript de aproximadamente 126 kB gzip e CSS de 10,4 kB gzip. Tamanho de build não substitui teste de desempenho no dispositivo.
- API respondeu com versão 0.2.0 e coletor ativo tanto em loopback quanto em `192.168.3.42:8765`. Isso verifica o acesso pelo endereço de rede neste Mac; o teste a partir de um celular real é feito pelo usuário.
- A restrição a 192.168.3.0/24 e a rejeição de outra sub-rede/origem foram verificadas com requisições de teste.
- A inspeção visual automatizada permanece indisponível pela recusa de acesso já registrada. Não foi usada a nova origem LAN para contornar essa restrição.

### Consulta internacional real

LHR → JFK, 05/11/2026, um adulto, econômica, solicitação de uma mala despachada: 23 itinerários interpretados nos grupos 2 e 3, em aproximadamente 1,46 s. A amostra de menor preço foi uma opção TAP (`TP`), saída 12:25, chegada 20:05, duração total de 760 minutos (considerando os fusos), uma escala, R$ 2.220,00. A consulta registra `checked_bags_requested=1`; esse dado demonstra a solicitação, sem comprovar a franquia ou a taxa efetivamente cobrada pela companhia. Preços são apenas o retrato dessa consulta.

### Refinamento após teste no celular

- Confirmada a causa do contador longo: espera exponencial após falhas, que podia levar a cadência de cinco a trinta minutos. Removida a multiplicação; teste cobre intervalos e ciclos que ultrapassam uma cadência.
- Falhas relatadas reproduzidas por rota. MIA → FOR em 30/10/2026 retornou seis opções válidas, preservando a consulta ao descartar duas opções com transferência não suportada. GRU → FOR em 05/11/2026 retornou quinze opções válidas, descartando uma com aeroporto não encontrado no catálogo.
- Dois testes verificam que uma oferta inválida não descarta as válidas e que todas as ofertas inválidas continuam sendo erro.
- Campos de aeroportos não convidam automaticamente a adicionar mais de um. Alertas usam opção geral de ativação seguida de canais, com e-mail funcional e WhatsApp/Telegram ainda indisponíveis.
- Diagnóstico técnico de consultas recolhido no acompanhamento; ação “Buscar agora” visível.

Após reiniciar o serviço, as três buscas do usuário concluíram ciclos sem erro. As duas configuradas para cinco minutos apresentavam esperas de 281 e 288 segundos na amostra de verificação, ambas dentro da cadência salva. Esse registro não garante disponibilidade contínua da fonte.

Pares de cores principais medidos: texto principal/branco 13,28:1; texto secundário/fundo 5,93:1; branco/botão primário 7,20:1; texto secundário/sugestão de aeroporto 5,49:1. Isso verifica esses pares, sem certificar acessibilidade integral da interface.

## Registro anterior — versão 0.1.0

Executada em 16/10/2026. As quantidades abaixo são um retrato do teste, não garantias de disponibilidade futura.

## Verificações concluídas

- **20 testes automatizados aprovados** por `python -m unittest discover -s tests -v`.
- Build TypeScript/Vite concluído: JavaScript de aproximadamente **115,84 kB gzip** e CSS de **8,45 kB gzip**. Isso mede os arquivos gerados, não substitui uma medição de desempenho no dispositivo.
- API de saúde respondeu `ok: true`, versão `0.1.0`, com trabalhador de coleta ativo.
- Busca real de THE → GRU/CGH com saída entre 05/11/2026 22:00 e 06/11/2026 06:00 e volta em 09/11/2026.
- Na verificação após reiniciar o processo, havia **11 ciclos**, **22 snapshots**, **13 opções elegíveis** e **um evento de alerta** preservados no SQLite. SMTP permanecia desabilitado, sem envio externo.
- Consulta separada para dois adultos retornou oito opções e menor preço de grupo de R$ 1.986 naquele momento; os textos da interface identificam o preço pelo grupo e por trecho.

## Últimas rotas observadas

Filtros: um adulto, econômica, no máximo uma escala, duração total de até oito horas. Ida com janela noturna; volta com o dia completo.

| Consulta | Data | Opções retornadas | Elegíveis |
|---|---|---:|---:|
| THE → CGH | 05/11/2026 | 6 | 0 |
| THE → GRU | 05/11/2026 | 8 | 0 |
| THE → CGH | 06/11/2026 | 10 | 2 |
| THE → GRU | 06/11/2026 | 8 | 1 |
| GRU → THE | 09/11/2026 | 8 | 6 |
| CGH → THE | 09/11/2026 | 9 | 4 |

As seis consultas foram interpretadas sem falha nessa amostra. Zero opções elegíveis em uma data é diferente de falha de coleta e não representa ausência de todos os voos na fonte.

## Cobertura dos testes automatizados

- Limites inclusivos da janela que atravessa a meia-noite e rejeição de partidas fora dela.
- Combinação de aeroportos/datas sem duplicação.
- Duração total, categorias exatas de escalas, tempo de conexão e limite de chegada independentes.
- Cálculo de tempo entre aeroportos em fusos diferentes.
- Primeira meta atingida sem economia anterior inventada; cálculo do percentual de queda.
- Deduplicação e intervalo de silêncio.
- Ciclos parciais sem disparo de alertas para a direção afetada.
- Nova versão de filtros e de adaptador sem comparação artificial de queda.
- Agrupamento de ida e volta em uma mensagem.
- Cancelamento de mensagem pendente de busca pausada.
- Aceitação SMTP preservada mesmo quando QUIT falha depois do envio.
- Credenciais locais com permissão 0600, senha ausente das respostas e dos erros de validação.
- Criação, edição, pausa, arquivamento e restauração pela API, em banco temporário.
- Rejeição de operações sem token local ou oriundas de outro site.
- Exportação sem configurações SMTP ou token da sessão.

Os testes de SMTP usam objetos simulados e não enviam e-mails. A entrega ao provedor real continua pendente da configuração pelo usuário e do teste explícito pela interface.

## Preparação do Git

- Repositório local inicializado na pasta deste projeto, branch `main`.
- `git remote -v` sem remotos; nenhum commit ou push realizado.
- Regras de exclusão verificadas para `.env`, `.env.production`, `.data/radar.sqlite3`, `.data/smtp-private.json`, `frontend/node_modules` e `frontend/dist`.
- Lockfiles de Python e Node incluídos. Workflow preparado para uso futuro no GitHub, sem execução remota nesta entrega.

## Limitação de validação visual

O navegador recusou a inspeção da origem `http://127.0.0.1:8765/`, inclusive após o usuário informar a liberação. A leitura das configurações locais confirmou `access = allow` para a origem, mas a ferramenta continuou relatando uma recusa salva ou administrada. Não foi possível determinar se há estado anterior na sessão ou outra política em vigor.

Por isso, não há alegação de teste visual em desktop/celular nem captura da interface funcional nesta entrega. Os layouts responsivos, foco e diálogos foram implementados e compilados, mas precisam dessa inspeção visual quando o acesso funcionar. Nenhum mecanismo alternativo foi usado para contornar o bloqueio.

## Revisão 0.8 — 16/10/2026

113 testes Python aprovados; verificações frontend de tradução, oito cenários de moeda e formatação internacional de telefone aprovadas. TypeScript e build Vite 0.8.0 concluídos. Novo conjunto `tests/test_refinement.py` cobre histórico sem repetições, migração/cadência fixa, recuperação e isolamento de tokens, origem canônica, revogação de sessões, silêncio e cache de logos. E-mails/downloads são simulados nesses testes.

Servidor reiniciado com cópia privada SQLite anterior à migração. Health confirmou 0.8.0 e coletor ativo; integridade SQLite, chaves estrangeiras, migração das cadências e campos de perfil verificados. Origem canônica dos links locais definida como `http://192.168.3.42:8765`. A validação visual continua pendente pelo bloqueio descrito acima.

## Revisão 0.9 — 16/10/2026

114 testes Python aprovados, incluindo pool de candidatos por proprietário/versão, preservação das contagens dos filtros salvos, resposta enxuta sem histórico/ciclos e cache privado das imagens. Verificações frontend de tradução, moedas, telefone e prévia local aprovadas; o novo teste cobre restringir/ampliar duração e escalas, meia-noite, limites de chegada, conexões, companhias, somente ida e compatibilidade dos parâmetros da coleta. Build TypeScript/Vite 0.9.0 concluído.

Dois revisores avaliaram IHC/acessibilidade e desempenho por código. Foram corrigidos aviso de saída envolvendo outros rascunhos e validação de escalas ao salvar diretamente por abas. Servidor reiniciado após backup privado; health confirmou 0.9.0 e coletor ativo, com integridade SQLite/chaves estrangeiras verificadas. Nenhum teste acionou consulta de tarifas ou envio real de e-mail.

A tentativa autorizada de inspecionar a sessão aberta foi recusada novamente por uma permissão salva/gerenciada do navegador. Nenhuma alternativa foi utilizada para contornar a política. Responsividade, contraste final, zoom e comportamento de foco ainda precisam de conferência visual autorizada no dispositivo.

## Revisão 0.10 — 16/10/2026

123 testes Python aprovados. O novo conjunto cobre home vazia/com múltiplas buscas, resumo de preços, respostas condicionais sem leitura de voos, revisão isolada por conta, mudanças de envio/perfil/exclusão, histórico geral paginado com buscas encerradas, distinção entre altas/quedas e notificações, contrato anterior de entregas pessoais e retenção com preservação de snapshots/avisos/recuperação de tarifa.

Seis verificações frontend aprovadas: tradução, moeda, telefone, prévia dos filtros, renderização isolada da home e cache condicional com vencimento por partida. TypeScript/Vite 0.10.0 compilado. Sem consulta de tarifa ou envio real nos testes. Componentes renderizados com dados fictícios não representam inspeção visual da sessão do navegador.

Backup privado anterior à migração. Processo reiniciado em rede local com retenção de 30 dias; health confirmou 0.10.0 e coletor ativo. Integridade SQLite, chaves estrangeiras, tabela de revisão por conta e gatilhos verificados no ambiente. Nenhum commit/push/publicação realizado. A conferência visual permanece pendente pelo bloqueio do navegador já registrado.

## Revisão 0.11 — 16/10/2026

129 testes Python aprovados, incluindo catálogo de nomes/siglas, aliases com acentos, ordenação, limite, códigos fora do catálogo, autenticação e consulta em lote. Sete verificações frontend aprovadas: idiomas, moedas, telefone, prévia, home, cache de estado e preferências compactas. O novo teste usa renderização isolada com dados fictícios para verificar combobox, etiquetas, duração, bagagem e opções adicionais inicialmente recolhidas; não simula uma sessão do navegador. TypeScript/Vite 0.11.0 compilado.

Servidor reiniciado após backup privado. Health confirmou 0.11.0 com coletor ativo; integridade SQLite e chaves estrangeiras verificadas. O catálogo de referência contém 1.112 códigos, com origem/commit/licença preservados. Nenhum teste fez consulta de tarifa ou envio de e-mail. A análise visual partiu da captura fornecida; a conferência interativa continua pendente pelo bloqueio de origem previamente registrado.


## Revisão 0.12 — 16/10/2026

141 testes Python aprovados; oito verificações frontend (idiomas, moedas, telefone, prévia, home, estado condicional, preferências e administração) aprovadas. TypeScript/Vite 0.12.0 compilado. Testes administrativos usam contas fictícias e bancos temporários: escopo exclusivo do administrador, paginação de 15 registros, filtros, corpo protegido, vínculo de propriedade, serviço real da tentativa simulado, isolamento dos canais futuros, retenção de 90 dias e prévia/assinatura/confirmação da limpeza. Não enviam e-mails nem consultam tarifas.

Nova política remove apenas registros operacionais de envio já concluídos, em lotes horários limitados. Pendentes e mensagens em processamento, preços e histórico de oportunidades são preservados. Nenhuma limpeza manual foi realizada no banco do usuário. WhatsApp/Telegram permanecem indisponíveis. Análise baseada na captura fornecida e renderização isolada; inspeção visual interativa pendente pelo bloqueio já descrito.

Servidor reiniciado com backup privado anterior à migração. Health confirmou versão 0.12.0 e coletor ativo. SQLite íntegro, sem violações de chaves estrangeiras; metadados, índices e gatilhos do registro de envios instalados e primeira verificação de retenção registrada. Nenhum commit, push ou publicação realizado.


## Revisão 0.13 — 16/10/2026

151 testes Python aprovados; nove verificações frontend aprovadas, incluindo o novo cenário de cadastros manuais, contatos internacionais, preferências e redefinição separada de senha. TypeScript/Vite 0.13.0 compilado. Testes com bancos temporários cobrem escopo administrativo, CSRF, preservação da sessão do administrador, limite/normalização de contatos, telefone duplicado e rollback, contatos no perfil pessoal, senhas em hash e ausentes das respostas, revogação das sessões e links de recuperação, autoria na auditoria, política persistida de retenção e confirmação vinculada ao tipo de log.

Nenhum teste alterou senhas/contatos de clientes reais, executou limpeza manual no banco privado ou enviou e-mails. A retenção automática continua em 90 dias até configuração explícita. WhatsApp e Telegram armazenam contatos para uso futuro, sem envio ativo. A verificação visual interativa continua pendente pelo bloqueio de origem descrito acima.

Servidor atualizado após backup privado anterior à migração. Health confirmou versão 0.13.0 com coletor ativo. Integridade SQLite e chaves estrangeiras verificadas; campos de telefones adicionais/autoria e índice de retenção instalados. Nenhuma publicação, commit ou push realizado.


## Revisão 0.14 — 16/10/2026

155 testes Python e dez verificações frontend aprovados; TypeScript/Vite 0.14.0 compilado. Novos testes cobrem categorias/limites de passageiros, serialização até a consulta e link, preservação do preço total do grupo, metadados coletados, alertas concisos em três idiomas, avanço ida/volta e somente ida, retorno padrão anterior à ida, nome automático/personalizado e prévias incompatíveis com outro grupo.

A tela inicial foi revisada com base nas capturas fornecidas. Testes de renderização verificam os controles de cabine e crianças, ausência do antigo menu e preservação dos demais filtros. Não houve consulta real de tarifas nem envio de mensagens nesses testes. A conferência visual interativa permanece pendente pelo bloqueio de origem já descrito.

Servidor reiniciado após backup privado; health confirmou 0.14.0 e coletor ativo. Integridade SQLite e chaves estrangeiras verificadas. Nenhum commit, push ou publicação realizado.


## Revisão 0.15 — 16/10/2026

Dez verificações frontend aprovadas e TypeScript/Vite 0.15.0 compilado. A cobertura de preferências agora verifica separação dos filtros rápidos e do formulário de alertas, ausência de duplicação de bagagem, destinatários preservados, preço por grupo e explicação de moeda inicialmente recolhida. O teste de fluxo também confirma salvamento direto do formulário de alertas sem avançar as etapas da viagem. Sem mudança funcional do backend; não foi repetida a suíte Python, que teve 155 testes aprovados na revisão 0.14.

Documentação pública OpenWA consultada por GET, sem credenciais, leitura de sessões privadas ou envio de mensagens. WhatsApp permanece indisponível até a integração. A revisão visual usa a captura enviada; a conferência interativa continua pendente pelo bloqueio anteriormente registrado.

Servidor reiniciado após backup privado. Health confirmou 0.15.0 e coletor ativo; SQLite íntegro e sem violações de chaves estrangeiras. Nenhum commit, push ou publicação realizado.


## Revisão 0.16 — 16/10/2026

173 testes Python e 11 verificações frontend aprovados; TypeScript/Vite 0.16.0 compilado. A nova cobertura WhatsApp usa contas/bancos temporários e transportes simulados. Verifica ACL/CSRF, token omitido e arquivo 0600, preservação da credencial e nova exigência ao mudar identidade, segundo provedor com campos distintos, configuração inválida, verificação com limite, teste somente enfileirado, contatos deduplicados, aceitação por destinatário, falha parcial entre canais/números, ausência de reenvio incerto, troca de sessão/desabilitação, pausa, contatos alterados, expiração, silêncio e reinício. O HTTP é testado sem rede: cabeçalho, rota, payload, ID, erros sanitizados, timeout e rejeição de redirecionamento.

A migração de alertas antigos foi corrigida para reconstruir as associações de fila sem gatilhos que bloqueiem a troca da tabela; o conjunto de contas foi verificado novamente após esse ajuste. A interface valida campos guiados por integrador, credencial em campo password, indicação de token salvo, teste explícito e seleção simultânea de canais.

Nenhuma mensagem real ou leitura autenticada de sessão externa foi executada. A conexão ainda depende das credenciais do administrador. A inspeção visual interativa continua pendente pelo bloqueio documentado. Detalhes e limites em `docs/WHATSAPP.md`.

Servidor reiniciado com backup privado anterior à migração. Health confirmou 0.16.0, coletor ativo e trabalhador WhatsApp ativo. SQLite íntegro, sem violações de chaves estrangeiras; campos de transporte e associação indexada de entregas instalados. A configuração WhatsApp real permanece desativada e sem token cadastrado. Sem commit, push ou publicação.


## Revisão 0.16.1 — 16/10/2026

Onze verificações frontend e compilação TypeScript/Vite aprovadas. Testes verificam adultos antes de crianças, bebês inicialmente recolhidos, título contextual sem aviso extra na volta, avanço automático somente após concluir o horário final (desfoque/Enter) ou confirmar ajuste da régua, valores recentes preservados, ausência de avanço durante digitação, validação de rota, somente ida e edição de buscas existentes. Retornar deliberadamente à ida não provoca novo avanço automático. O botão Continuar permanece como alternativa, inclusive para aceitar horários padrão.

Janela ampliada para até 860px e altura disponível da tela, campos de data/hora lado a lado no desktop, régua com altura mínima e ajuda sobre meia-noite preservadas. Em telas pequenas/baixas mantém rolagem e rodapé acessível. Sem alterações funcionais no backend: suíte Python não repetida. Não houve consulta de tarifas nem envio de mensagens nos testes. Conferência visual interativa permanece pendente devido ao bloqueio da origem pelo navegador.

Servidor atualizado após backup privado. Health confirmou 0.16.1 com coletor e trabalhador WhatsApp ativos; SQLite íntegro, sem violações de chaves estrangeiras. Sem commit, push ou publicação.


## Revisão 0.16.2 — 16/10/2026

Seletor de datas das janelas de partida substituído por calendário React DayPicker e popover Radix, com meses/anos selecionáveis, navegação por teclado, seis semanas de altura estável, data selecionada e dia atual destacados, entrada manual localizada e validação. Estilo azul discreto e alvos maiores no celular. Datas continuam sem conversão UTC para evitar troca de dia por fuso. Regra de duração e avanço ida/volta preservados. Campos de duração ampliados para não cortar dois dígitos junto aos controles numéricos nativos.

Doze verificações frontend e compilação TypeScript/Vite aprovadas. Nova cobertura testa datas inválidas/bissextas, quatro fusos, entrada PT/EN/ES, seleção/fechamento, rejeição de entrada inválida e seis semanas. Testes anteriores de ida/volta e filtros continuam aprovados. Sem consultas de tarifas ou envio real nos testes. Conferência visual interativa segue pendente pelo bloqueio da origem no navegador. Sem mudanças funcionais no backend e sem repetição da suíte Python.

Referências de implementação: https://daypicker.dev/docs/selection-modes/ e https://www.radix-ui.com/primitives/docs/components/popover.

Servidor atualizado; health confirmou 0.16.2 com os dois trabalhadores ativos. Sem commit, push ou publicação.


## Revisão 0.17 — 16/10/2026

Preferências passam por ida e volta antes de concluir uma nova busca, com valores independentes e botão de retorno ao trecho anterior. Somente ida e abas de edição preservadas. Duração passa a ser opcional (`null`) no modelo e nos filtros local/servidor. Novas buscas sem limite de duração; opção de ativar limite explícito entre 1 e 48 horas. Limites existentes preservados sem alteração automática. Escalas e demais critérios continuam independentes; a ausência de limite de duração não amplia a cobertura da fonte.

Campo de data principal volta a ser editável, com teclado numérico, máscara progressiva, posição do cursor e tratamento de exclusão sobre separadores. Só o ícone abre o calendário. Entrada manual do popover usa a mesma máscara; formato acompanha PT/EN/ES. Datas inválidas/incompletas bloqueiam o formulário, e seleção pelo calendário limpa o erro do campo.

174 testes Python, 12 verificações frontend e compilação TypeScript/Vite aprovados. Novos testes cobrem revisão das duas direções e preservação de preferências distintas, ativar/desativar limite, itinerário de 70h com cinco escalas, limite inclusivo de 48h e preservação dos limites antigos, máscaras/cursor/exclusão/entrada incompleta. Testes usam dados simulados sem consultas de tarifas ou envio real de mensagens. A conferência visual interativa permanece pendente pelo bloqueio de origem do navegador.

Servidor atualizado após backup privado. Health confirmou 0.17.0 com coletor e trabalhador WhatsApp ativos. SQLite íntegro e sem violações de chaves estrangeiras. Sem commit, push ou publicação.


## Revisão 0.18 — 16/10/2026

Salvar critérios compatíveis preserva o pool de voos coletados. A versão de filtros continua separada para não comparar preços nem emitir alertas contra critérios anteriores. `filter_result_refs` referencia respostas imutáveis, sem copiar JSON, alterar o instante da coleta, fabricar snapshots ou disparar consultas/envios ao salvar. Só mantém referências da versão atual; retenção/exclusão de respostas remove referências por chave estrangeira. Mudança de adaptador invalida referências.

Compatibilidade exige mesmos aeroportos, passageiros, cabine, moeda, bagagem e datas pesquisadas. Duração, escalas, companhias, horários dentro das mesmas datas e limites de conexão são reaplicados imediatamente. Novas respostas substituem o cache por rota; falhas continuam usando o último resultado válido sinalizado como anterior. Uma resposta válida vazia não restaura preços antigos. O resumo na home reaplica os mesmos critérios enquanto aguarda nova coleta. Confirmação de salvamento distingue filtros aplicados de nova consulta necessária.

179 testes Python, 12 verificações frontend e compilação TypeScript/Vite aprovados. Regressões verificam múltiplos salvamentos, restringir/ampliar, zero resultados recuperável ao relaxar filtro, timestamp original, resumo na home, ausência de duplicação/alertas/snapshots fabricados, nova resposta vazia, falha com fallback, invalidação por dados de aquisição e exclusão em cascata. Dados de teste temporários, sem consulta real de tarifas ou envio de mensagens. Conferência visual interativa continua bloqueada pela política do navegador; não foi usado navegador alternativo para contornar o bloqueio.

Servidor atualizado após backup privado. Health confirmou 0.18.0 com coletor e trabalhador WhatsApp ativos. Tabela de referências instalada; SQLite íntegro e sem violações de chaves estrangeiras. Nenhuma configuração de monitoramento real foi alterada pela correção; sem commit, push ou publicação.


## Revisão 0.19 — 16/10/2026

Barra lateral usa duas linhas fixas (nome e rota), truncamento de nomes longos com título completo disponível e ícones/status sem compressão. Contagem usa o limite real da conta. Lista paginada de cinco itens, navegação acessível e acompanhamento do monitoramento selecionado. Contas com até cinco buscas não exibem paginação.

Cota `search_limit` persistida por conta, padrão cinco (inclusive contas existentes), configurável de 1 a 100 em Administração → Cadastros ao criar/editar usuário. Só administradores podem alterá-la; perfis e cadastro público não podem elevá-la. Ativas e pausadas contam; encerradas não. Criação e restauração aplicam a cota em transação imediata SQLite, usando o valor atual do banco. Reduzir a cota preserva monitoramentos existentes e impede novas inclusões até haver vaga. Clientes administrativos antigos que omitem o campo preservam seu valor. Alterações ficam na auditoria administrativa já existente.

181 testes Python, 13 verificações frontend e compilação TypeScript/Vite aprovados. Novas regressões cobrem cadastro padrão/customizado, validação de limites, ACL, tentativa de elevar a própria cota, pausa/encerramento/restauração, redução com excesso de buscas, preservação quando campo omitido e navegação/seleção/truncamento sem perda de nome acessível na lateral. Testes usam dados temporários e não consultam tarifas nem enviam mensagens. Conferência visual baseada na captura fornecida; inspeção interativa continua bloqueada pela política do navegador.

Servidor atualizado após backup privado. Health confirmou 0.19.0 com ambos os trabalhadores ativos. Campo de cota instalado; SQLite íntegro e sem violações de chaves estrangeiras. Nenhuma cota real foi elevada automaticamente. Sem commit, push ou publicação.


## Revisão 0.19.1 — 16/10/2026

Resumo compartilhado entre barra lateral e cartões da home: nomes gerados a partir de rota/data são apresentados como rota única, sem duplicá-la abaixo; nomes personalizados são preservados e acompanhados da rota. Reconhecimento dos nomes gerados nos três idiomas, sem regravar registros. Datas são identificadas explicitamente como Ida/Volta; intervalos que cruzam datas exibem início e fim. A lateral usa datas compactas sem reticências e título acessível com datas completas; nome longo continua com truncamento. Ida/volta usam ↔ também na lateral.

13 verificações frontend e TypeScript/Vite aprovados. Fixtures incluem o caso EZE ↔ NAT com ida 11/12 e volta 18/12, ausência de rota duplicada, nome personalizado e janela atravessando datas. Backend sem mudança funcional, suíte Python não repetida (181 aprovados em 0.19.0). Validação visual pela captura recebida; navegador interativo ainda bloqueado.

Servidor atualizado; health confirmou 0.19.1 com ambos os trabalhadores ativos. Sem alteração em nomes ou configurações persistidas e sem publicação.


## Revisão 0.20 — 16/10/2026

Entrega de Docker/Compose e guia de implantação. Apenas a aplicação é empacotada e publica porta; nenhum proxy é instalado/incluído. Modo público opt-in exige domínio HTTPS canônico e um IP de proxy confiável, fecha cadastro/primeiro administrador pela web, usa cookies Secure e mantém o modo local. Primeiro administrador por terminal. Backend é uma instância com SQLite/credenciais em volume persistente. Runtime UID/GID 10001, raiz somente leitura, capacidades removidas, sem escalada de privilégios e logs rotacionados.

187 testes Python e 14 verificações frontend aprovados, TypeScript/Vite compilado. Novos testes cobrem Host/HTTPS/Origin, cabeçalhos apenas de proxy confiável, cookies seguros, cadastro/bootstrap públicos fechados, formulário de login, backup consistente e restauração validada sem herdar credenciais posteriores. Scanner de staged blobs e inventário Git conferidos; dados e credenciais desta instalação, identidade OAuth, dependências e artefatos gerados ficam fora do commit/contexto Docker.

Build Linux ARM64 realizado e containers local/público iniciados saudáveis com dados de fixture separados. Verificados execução sem root, ausência da identidade OAuth privada na imagem, volume persistente entre recriações, porta publicada e cabeçalhos confiáveis passando pelo gateway Docker real. Primeiro administrador CLI, recusa de substituição, backup, cópia para host e restore por stdin verificados em volume descartável. Sem consultas de tarifas ou envio de mensagens nesses testes de container. HTTPS do domínio e conectividade dos provedores na VPS continuam a cargo da validação de implantação real. O fluxo Google permanece local; SMTP é o caminho documentado para primeiro deploy público.

Build Linux AMD64 também concluído por emulação no host ARM64. O guia considera um proxy externo já existente, sem arquivos de configuração de Nginx ou outros proxies. As amostras cloud/local de Compose foram validadas.

Container AMD64 público iniciado por emulação com rede desativada, raiz somente leitura e dados efêmeros. Health, ambos os trabalhadores e UID sem privilégios confirmados; nenhum volume real foi usado.

Instalação local reiniciada após backup privado: health 0.20.0 e ambos os trabalhadores ativos, SQLite íntegro. Containers/volumes descartáveis de teste removidos; instâncias de outros projetos preservadas. Sem envio ao GitHub ou implantação em servidor externo.
