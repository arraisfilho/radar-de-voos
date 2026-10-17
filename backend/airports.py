"""Bundled worldwide IATA catalog: airportsdata (MIT), no runtime network lookup."""
import unicodedata
import airportsdata

CATALOG = airportsdata.load("IATA")
AIRPORTS = {code: (a["city"] or a["name"], a["name"], a["tz"]) for code, a in CATALOG.items()}
ALIASES = {"sao paulo": "sao paulo", "nova york": "new york", "londres": "london", "lisboa": "lisbon", "roma": "rome", "toquio": "tokyo", "pequim": "beijing", "munique": "munich", "varsovia": "warsaw", "bruxelas": "brussels", "atenas": "athens"}
# Display spelling of Brazilian cities, keyed by the catalog's unaccented form. Search keeps
# using the catalog text: normalize() drops accents from queries and catalog alike.
BR_CITIES = {
    "Agua Boa": "Água Boa", "Alto Parnaiba": "Alto Parnaíba", "Anapolis": "Anápolis",
    "Aracatuba": "Araçatuba", "Aragarcas": "Aragarças", "Araguaina": "Araguaína", "Araxa": "Araxá",
    "Avare": "Avaré", "Bage": "Bagé", "Barra De Santo Antonio": "Barra de Santo Antônio",
    "Barra Do Corda": "Barra do Corda", "Barra Do Garcas": "Barra do Garças", "Belem": "Belém",
    "Bento Goncalves": "Bento Gonçalves", "Boca Do Acre": "Boca do Acre",
    "Bom Jesus Da Lapa": "Bom Jesus da Lapa", "Braganca Paulista": "Bragança Paulista",
    "Brasilia": "Brasília", "Caceres": "Cáceres", "Cachoeira Do Sul": "Cachoeira do Sul",
    "Cachoeiro Do Itapemirim": "Cachoeiro de Itapemirim", "Campo Mourao": "Campo Mourão",
    "Campos Dos Goytacazes": "Campos dos Goytacazes", "Carajas": "Carajás", "Cassilandia": "Cassilândia",
    "Catalao": "Catalão", "Caxias Do Sul": "Caxias do Sul", "Chapeco": "Chapecó",
    "Conceicao Do Araguaia": "Conceição do Araguaia", "Concordia": "Concórdia",
    "Cornelio Procopio": "Cornélio Procópio", "Corumba": "Corumbá", "Criciuma": "Criciúma",
    "Cristalandia": "Cristalândia", "Cruzeiro Do Sul": "Cruzeiro do Sul", "Cuiaba": "Cuiabá",
    "Cumaru Do Norte": "Cumaru do Norte", "Dianopolis": "Dianópolis", "Divinopolis": "Divinópolis",
    "Eirunepe": "Eirunepé", "Feira De Santana": "Feira de Santana", "Fernando De Noronha": "Fernando de Noronha",
    "Florianopolis": "Florianópolis", "Foz Do Iguacu": "Foz do Iguaçu", "Francisco Beltrao": "Francisco Beltrão",
    "Goiania": "Goiânia", "Guaira": "Guaíra", "Guajara-Mirim": "Guajará-Mirim",
    "Guaratingueta": "Guaratinguetá", "Guaruja": "Guarujá", "Humaita": "Humaitá", "Ijui": "Ijuí",
    "Ilheus": "Ilhéus", "Ipiau": "Ipiaú", "Irece": "Irecê", "Itubera": "Ituberá", "Januaria": "Januária",
    "Jatai": "Jataí", "Jequie": "Jequié", "Ji-Parana": "Ji-Paraná", "Joacaba": "Joaçaba",
    "Joao Pessoa": "João Pessoa", "Juazeiro Do Norte": "Juazeiro do Norte", "Juina": "Juína",
    "Juiz De Fora": "Juiz de Fora", "Labrea": "Lábrea", "Lencois": "Lençóis",
    "Lencois Paulista": "Lençóis Paulista", "Macae": "Macaé", "Macapa": "Macapá", "Maceio": "Maceió",
    "Manicore": "Manicoré", "Maraba": "Marabá", "Marilia": "Marília", "Maringa": "Maringá",
    "Matupa": "Matupá", "Maues": "Maués", "Minacu": "Minaçu", "Mossoro": "Mossoró",
    "Niquelandia": "Niquelândia", "Nova Iguacu": "Nova Iguaçu", "Novo Aripuana": "Novo Aripuanã",
    "Obidos": "Óbidos", "Oriximina": "Oriximiná", "Ourilandia Do Norte": "Ourilândia do Norte",
    "Paranagua": "Paranaguá", "Paranaiba": "Paranaíba", "Paranavai": "Paranavaí", "Parnaiba": "Parnaíba",
    "Patos De Minas": "Patos de Minas", "Pocos De Caldas": "Poços de Caldas", "Ponta Pora": "Ponta Porã",
    "Porto Alegre Do Norte": "Porto Alegre do Norte", "Porto De Moz": "Porto de Moz",
    "Porto Dos Gauchos": "Porto dos Gaúchos", "Redencao": "Redenção", "Ribeirao Preto": "Ribeirão Preto",
    "Rio De Janeiro": "Rio de Janeiro", "Rondonopolis": "Rondonópolis", "Salinopolis": "Salinópolis",
    "Santa Cruz Do Sul": "Santa Cruz do Sul", "Santa Isabel Do Rio Negro": "Santa Isabel do Rio Negro",
    "Santa Vitoria Do Palmar": "Santa Vitória do Palmar", "Santana Do Araguaia": "Santana do Araguaia",
    "Santarem": "Santarém", "Santo Angelo": "Santo Ângelo", "Santo Antonio Do Ica": "Santo Antônio do Içá",
    "Sao Borja": "São Borja", "Sao Carlos": "São Carlos", "Sao Felix Do Araguaia": "São Félix do Araguaia",
    "Sao Felix Do Xingu": "São Félix do Xingu", "Sao Gabriel Da Cachoeira": "São Gabriel da Cachoeira",
    "Sao Joao Del Rei": "São João del-Rei", "Sao Jose Do Rio Preto": "São José do Rio Preto",
    "Sao Jose Dos Campos": "São José dos Campos", "Sao Lourenco": "São Lourenço",
    "Sao Lourenco Do Sul": "São Lourenço do Sul", "Sao Luis": "São Luís", "Sao Mateus": "São Mateus",
    "Sao Miguel Do Araguaia": "São Miguel do Araguaia", "Sao Miguel Do Oeste": "São Miguel do Oeste",
    "Sao Paulo": "São Paulo", "Sao Paulo De Olivenca": "São Paulo de Olivença",
    "Sao Raimundo Nonato": "São Raimundo Nonato", "Tangara Da Serra": "Tangará da Serra",
    "Tarauaca": "Tarauacá", "Taubate": "Taubaté", "Tefe": "Tefé", "Teixeira De Freitas": "Teixeira de Freitas",
    "Telemaco Borba": "Telêmaco Borba", "Teofilo Otoni": "Teófilo Otoni", "Tres Coracoes": "Três Corações",
    "Tres Lagoas": "Três Lagoas", "Tucurui": "Tucuruí", "Uberlandia": "Uberlândia",
    "Uniao Da Vitoria": "União da Vitória", "Valenca": "Valença",
    "Vila Bela Da Santissima Trindade": "Vila Bela da Santíssima Trindade", "Vitoria": "Vitória",
    "Xanxere": "Xanxerê",
}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))


LABEL_SUFFIXES = (" International Airport", " Intl Airport", " Airport")


def short_label(name):
    """Catalog name without a common English suffix: "Congonhas Airport" -> "Congonhas"."""
    for suffix in LABEL_SUFFIXES:
        if name.endswith(suffix) and name[:-len(suffix)].strip():
            return name[:-len(suffix)].strip()
    return name


def display_city(code):
    """City for display: Portuguese spelling for Brazil ("Sao Paulo" -> "São Paulo"), else the catalog's."""
    a = CATALOG[code]
    city = a["city"] or a["name"]
    return BR_CITIES.get(city, city) if a["country"] == "BR" else city


def airport_record(code):
    a = CATALOG[code]
    return {"code": code, "city": display_city(code), "name": a["name"], "label": short_label(a["name"]), "country": a["country"], "timezone": a["tz"]}


INDEX = [(code, normalize(" ".join(str(a[k]) for k in ("iata", "icao", "city", "name", "country", "subd")) )) for code, a in CATALOG.items()]


def search_airports(query, limit=20):
    query = normalize(query.strip())
    if len(query) < 2:
        return []
    query = ALIASES.get(query, query)
    words = query.split()
    found = [code for code, text in INDEX if all(word in text for word in words)]
    def rank(code):
        city = normalize(CATALOG[code]["city"])
        name = normalize(CATALOG[code]["name"])
        score = (0 if code.casefold() == query else 1 if code.casefold().startswith(query)
                 else 2 if city == query else 3 if city.startswith(query)
                 else 4 if query in name else 5)
        return score, city, code
    found.sort(key=rank)
    return [airport_record(code) for code in found[:limit]]
