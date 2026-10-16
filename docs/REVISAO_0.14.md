# Primeiro monitoramento e passageiros — 0.14

A página inicial sem buscas usa um cartão com ícone e título alinhados, mensagem em duas frases separadas e ações agrupadas. Em telas pequenas as frases podem quebrar para manter a leitura sem corte; os botões ocupam a largura disponível.

## Cadastro da busca

- **Tipo de viagem, crianças, adultos e cabine** ficam na mesma faixa em telas maiores. No celular, adultos e cabine continuam lado a lado na segunda linha.
- **Bebês (opcional)** mantém recolhidos os contadores de bebês com assento e no colo.
- O grupo pode ter até nove passageiros, incluindo bebês. Cada bebê no colo exige um adulto. A interface desabilita combinações incompatíveis e o servidor valida os mesmos limites.
- O antigo menu **Nome e cabine** foi removido. O nome opcional aparece na confirmação final, com sugestão pela rota e pela data. Nomes já cadastrados são preservados na edição.

## Ida e volta

Na criação, **Continuar para a volta** confirma a janela da ida e abre a janela da volta, com foco na data. A etapa de preferências só é aberta depois da confirmação da volta. A busca somente de ida avança diretamente às preferências.

O formulário não muda de trecho durante a digitação de data ou horário. O avanço acontece ao confirmar com o botão ou envio do formulário, permitindo revisar a janela sem saltos de foco. Datas de volta previamente editadas não são sobrescritas. Um padrão de volta que ficou anterior à nova ida é atualizado apenas quando ainda não foi editado.

Se a data inicial for movida para além do fim atual, a janela final acompanha a mudança, preservando sua duração; o usuário pode ajustá-la. A edição de um monitoramento existente mantém as abas e a possibilidade de alterar somente o trecho desejado.

## Consulta e preços

As categorias de crianças, bebês com assento e bebês no colo foram verificadas no `Passengers` da dependência instalada e são encaminhadas até a consulta e seu link externo. A integração não fornece idades individuais; não foi criado um filtro de idade que a fonte não recebe.

O valor continua sendo o **total do grupo por trecho**, sem multiplicação ou divisão artificial. Resultados, resumos e alertas indicam passageiros quando o grupo inclui crianças ou bebês. Ofertas antigas que não têm os novos contadores continuam representando apenas os adultos registrados na coleta.

Alterar a composição do grupo impede o reaproveitamento da prévia de preços de outro grupo e exige nova coleta. Ao salvar filtros, o versionamento existente mantém a referência de comparação separada. Buscas antigas recebem contadores zero por padrão, sem alteração das suas regras ou quantidade de adultos.

## Verificação

155 testes Python, dez verificações frontend e build TypeScript/Vite. Foram exercitados limites, categorias serializadas, links distintos, preço total preservado, alertas em três idiomas, avanço ida/volta, somente ida, datas de retorno padrão, nome automático/personalizado e isolamento de prévias por grupo.

Os testes usam respostas e usuários fictícios, sem consultar tarifas ou enviar mensagens reais. A validação visual interativa continua pendente pelo bloqueio do navegador já documentado; a revisão visual baseou-se nas capturas fornecidas e na estrutura renderizada dos componentes.
