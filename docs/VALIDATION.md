# Validação

## Verificações automatizadas

O [workflow de CI](../.github/workflows/checks.yml) executa:

| Área | Verificação |
|---|---|
| Backend | Testes Python de regras, persistência, contas, autorização, filas e integrações |
| Frontend | TypeScript, build Vite e fixtures de formulários, navegação, máscaras e idiomas |
| Alertas | Formatos por canal, economia comparável, HTML escapado, MIME multipart e links com destino/expiração controlados |
| Container | Validação Compose, build da imagem e callback OAuth em runtime isolado |

Os testes usam dados temporários e provedores simulados. Não comprovam disponibilidade da fonte nem envio real. Comandos locais estão no [guia de desenvolvimento](DEVELOPMENT.md); resultados por revisão estão no [GitHub Actions](https://github.com/arraisfilho/radar-de-voos/actions).

O teste de runtime executa sem rede e sem volumes: confere o catálogo de traduções, a origem HTTPS e a resposta segura do callback para estado inválido. Não autoriza uma conta Google.

## Validação operacional

Após instalação ou alteração relevante:

1. Confira versão e trabalhadores em `/api/health`.
2. Valide login, logout, permissões e recuperação de senha.
3. Crie um monitoramento e confirme coleta, filtros e histórico.
4. Autorize o remetente e solicite envios de teste para destinatários controlados.
5. Confira os registros por canal e o recebimento efetivo.
6. Verifique layouts em Safari, Chrome, Firefox e dispositivo móvel.
7. Teste backup e restauração em ambiente separado.

Valide o layout nos navegadores de destino. A saúde do processo não comprova entrega de mensagens nem conectividade com a fonte.
