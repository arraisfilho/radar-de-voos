# Configuração da instalação

`google-oauth-public.json` é gerado por `scripts/prepare_google_release.py` e fica ignorado no Git e no Docker. O clone não inclui a identidade Google desta máquina. Prepare sua própria identidade para o modo local conforme `docs/GOOGLE_MAIL.md`; para o deploy inicial na nuvem, use SMTP conforme `docs/DEPLOYMENT.md`.

Nunca copie o JSON original de credenciais Google, tokens ou senhas para esta pasta. O identificador público não substitui o provisionamento privado necessário para o fluxo local.

## Catálogo de companhias

`airlines.json` contém um catálogo local de referência por código IATA, nome e aliases. A origem e o commit estão em `airlines-source.json`; a licença Unlicense está preservada em `licenses/airlines-UNLICENSE.txt`. Fonte: [BesrourMS/Airlines](https://github.com/BesrourMS/Airlines). Os nomes abreviados de exibição LA/G3/AD foram ajustados localmente, preservando os originais como aliases. URLs de logomarcas e atributos de tarifas do conjunto original não foram importados.

O catálogo não comprova que a empresa está em operação nem que possui voos no trecho. Códigos podem mudar ou ser reutilizados, e nomes históricos podem existir. A disponibilidade depende da resposta da fonte de tarifas. É possível informar um código IATA de dois caracteres ausente do catálogo, escolhendo explicitamente a opção apresentada. Não há consulta externa para pesquisar companhias durante a digitação.
