#!/usr/bin/env python3
"""BUY-11037: Compact US + International Shopify merchant discovery + validation."""
import json, urllib.request, urllib.error, concurrent.futures, sys
from pathlib import Path

DATA = Path("data"); DATA.mkdir(exist_ok=True)
MERCHANTS = DATA / "us_shopify_merchants.json"

# Curated DTC brands — US + International
BRANDS = {
    "apparel": [
        "glossier.com","allbirds.com","rothys.com","everlane.com","bonobos.com",
        "untuckit.com","mizzenandmain.com","bombas.com","meundies.com","cutsclothing.com",
        "byltbasics.com","vuoriclothing.com","rhone.com","tenathousand.cc","bornprimitive.com",
        "gymshark.com","aloyoga.com","beyondyoga.com","outdoorvoices.com","fabletics.com",
        "lululemon.com","sweatybetty.com","carbon38.com","setactive.co","talaactive.com",
        "skims.com","goodamerican.com","spanx.com","fashionnova.com","revolve.com",
        "nastygal.com","princesspolly.com","whitefoxboutique.com","lulus.com","freepeople.com",
        "reformation.com","sezane.com","rouje.com","sandro-paris.com","maje.com",
        "kotn.com","tentree.com","outerknown.com","pactorganic.com","organicbasics.com",
        "naadam.co","summersalt.com","andieswim.com","leftonfriday.com","frankiesbikinis.com",
        "kith.com","aimeleondore.com","palaceskateboards.com","noahny.com","stussy.com",
        "fearofgod.com","rhude.com","amiri.com","representclo.com","jordan.com",
        "nike.com","adidas.com","newbalance.com","puma.com","reebok.com",
        "arcteryx.com","patagonia.com","thenorthface.com","columbia.com","marmot.com",
        "arcteryx.com","patagonia.com","llbean.com","eddiebauer.com","filson.com",
        "tedbaker.com","reiss.com","allsaints.com","bodenclothing.com","fatface.com",
        "joules.com","seasaltcornwall.com","superdry.com","frenchconnection.com","karenmillen.com",
    ],
    "beauty": [
        "sephora.com","ulta.com","dermstore.com","skinstore.com","bluemercury.com",
        "glossier.com","milk makeup.com","kosas.com","iliabeauty.com","meritbeauty.com",
        "saiehello.com","tower28beauty.com","westmanatelier.com","rarebeauty.com","fentybeauty.com",
        "charlottetilbury.com","pat mcgrath.com","hudabeauty.com","anastasiabeverlyhills.com",
        "drunkenskincare.com","biossance.com","youthtothepeople.com","theinkeylist.com",
        "theordinary.com","paulaschoice.com","dermalogica.com","skinceuticals.com",
        "versedskin.com","goodmolecules.com","naturium.com","cocokind.com","glowrecipe.com",
        "supergoop.com","soldejaneiro.com","farmacybeauty.com","herbivorebotanicals.com",
        "olehenriksen.com","muradskincare.com","fresh.com","origins.com","kiehls.com",
        "loccitane.com","rituals.com","moltonbrown.com","aveda.com","lushusa.com",
        "ritual.com","careof.com","humnutrition.com","seed.com","athleticgreens.com",
    ],
    "home": [
        "westelm.com","cb2.com","crateandbarrel.com","roomandboard.com","designwithinreach.com",
        "article.com","burrow.com","floydhome.com","joybird.com","albanypark.com",
        "maidenhome.com","benchmademodern.com","interiordefine.com","castlery.com","roveconcepts.com",
        "allmodern.com","jossandmain.com","birchlane.com","bludot.com","lumens.com",
        "brooklinen.com","parachutehome.com","bollandbranch.com","coyuchi.com","snowehome.com",
        "buffy.co","saatva.com","avocadogreenmattress.com","casper.com","purple.com",
        "helixsleep.com","nectarsleep.com","bearmattress.com","laylasleep.com","tuftandneedle.com",
        "ourplace.com","madeincookware.com","carawayhome.com","greatjonesgoods.com","misen.com",
        "materialkitchen.com","lodgecastiron.com","fieldcompany.com","smithey.com","finexusa.com",
        "yeti.com","hydroflask.com","stanley1913.com","simplemodern.com","corkcicle.com",
        "ruggable.com","revivalrugs.com","loloirugs.com","rugsusa.com","annieselke.com",
        "made.com","sofa.com","loaf.com","grahamandgreen.co.uk","oliverbonas.com",
    ],
    "food": [
        "magicspoon.com","eatbobos.com","hukitchen.com","skinnydipped.com","dangfoods.com",
        "dailyharvest.com","splendidspoon.com","freshly.com","factor75.com","territoryfoods.com",
        "hungryroot.com","sunbasket.com","greenchef.com","homechef.com","blueapron.com",
        "hellofresh.com","marleyspoon.com","gobble.com","purplecarrot.com","mosaicfoods.com",
        "drinkolipop.com","drinkpoppi.com","drinkculturepop.com","drinkghia.com","drinkkin.com",
        "drinkhaus.com","drinkmoment.com","drinkcelsius.com","drinkalani.com","drinklmnt.com",
        "bluebottlecoffee.com","stumptowncoffee.com","counterculturecoffee.com",
        "intelligentsiacoffee.com","deathwishcoffee.com","tradecoffeeco.com",
        "atlascoffeeclub.com","mistobox.com","angelscup.com","driftaway.coffee",
        "flybyjing.com","bachans.com","momofuku.com","yellowbirdsauce.com","secretardvark.com",
        "bareapple.com","bradsplantbased.com","thatsitfruit.com","larabar.com","rxbar.com",
    ],
    "electronics": [
        "bose.com","sonos.com","jbl.com","masterdynamic.com","audeze.com","shure.com",
        "sennheiser-hearing.com","beyerdynamic.com","klipsch.com","mezeaudio.com",
        "razer.com","corsair.com","logitechg.com","steelseries.com","hyperx.com",
        "secretlab.co","vertagear.com","gloriousgaming.com","gopro.com","insta360.com",
        "peakdesign.com","nomadgoods.com","bellroy.com","mujjo.com","twelvesouth.com",
        "satechi.net","anker.com","belkin.com","mophie.com","casetify.com",
        "dbrand.com","spigen.com","otterbox.com","speckproducts.com","incipio.com",
        "keychron.com","drop.com","duckychannel.com","novelkeys.com","kbdfans.com",
        "epomaker.com","wooting.io","zsa.io","modekeyboards.com","prusa3d.com",
        "bambulab.com","creality.com","elegoo.com","anycubic.com","flashforge.com",
    ],
    "fitness": [
        "roguefitness.com","repfitness.com","titan.fitness","fringesport.com","elitefts.com",
        "bala.com","theragun.com","hyperice.com","manduka.com","jadeyoga.com",
        "liforme.com","gaiam.com","onepeloton.com","tonal.com","hydrow.com",
        "ergatta.com","tempo.fit","vitruvian.co","mirror.co","nordictrack.com",
        "bowflex.com","schwinnfitness.com","gnc.com","bodybuilding.com","iherb.com",
        "vitaminshoppe.com","onnit.com","transparentlabs.com","legionathletics.com","ghostlifestyle.com",
    ],
    "baby_kids": [
        "stokke.com","nunababy.com","uppababy.com","doona.com","bugaboostrollers.com",
        "babybjorn.com","ergobaby.com","lillebaby.com","snoo.com","owletcare.com",
        "nanit.com","cuboai.com","miku.com","lovevery.com","montikids.com",
        "kiwico.com","littlepassports.com","fatbraintoys.com","melissaanddoug.com","lego.com",
        "bombababy.com","primary.com","hannakids.com","teacollection.com","kytebaby.com",
        "honest.com","hellobello.com","dyper.com","coterie.com","bambonature.com",
    ],
    "pets": [
        "farmersdog.com","ollie.com","nomnomnow.com","justfoodfordogs.com","petplate.com",
        "wild-one.com","barkbox.com","fi.com","whistle.com","petcube.com",
        "furbo.com","outwardhound.com","ruffwear.com","kurgo.com","kongcompany.com",
        "chewy.com","petsmart.com","petco.com","zestypaws.com","petlabco.com",
        "naturvet.com","vetsbest.com","pethonesty.com","nativepet.com","honestpaws.com",
    ],
    "jewelry_accessories": [
        "mejuri.com","auratenewyork.com","vrai.com","brilliantearth.com","catbirdnyc.com",
        "dorsey.co","missoma.com","analuisa.com","kinnstudio.com","linjer.co",
        "warbyparker.com","eyebuydirect.com","diffeyewear.com","blenderseyewear.com","goodr.com",
        "sunski.com","knockaround.com","ombraz.com","zennioptical.com","firmoo.com",
        "awaytravel.com","monos.com","beistravel.com","paravel.com","calpaktravel.com",
        "roamluggage.com","herschel.com","statebags.com","caraa.co","dbjourney.com",
        "cuyana.com","dagnedover.com","senreve.com","loandsons.com","nordace.com",
        "danielwellington.com","mvmt.com","vincerocollective.com","cluse.com","nordgreen.com",
    ],
    "musical_instruments": [
        "fender.com","gibson.com","martinguitar.com","taylorguitars.com","prsguitars.com",
        "ibanez.com","epiphone.com","sweetwater.com","guitarcenter.com","musiciansfriend.com",
        "strymon.net","earthquakesdevices.com","walrusaudio.com","jhspedals.com","chaseblissaudio.com",
        "mesaboogie.com","marshall.com","voxamps.com","orangeamps.com","moogmusic.com",
        "dwdrums.com","pearldrum.com","tama.com","zildjian.com","sabian.com",
        "daddario.com","ernieball.com","dunlop.com","elixirstrings.com","planetwaves.com",
        "native-instruments.com","ableton.com","focusrite.com","presonus.com","avid.com",
    ],
    "international": [
        # UK
        "nobodyschild.com","kitristudio.com","jigsaw-online.com","patmcgrath.com","skandium.com",
        "rockettstgeorge.co.uk","abigailahern.com","abigailahern.com","pipandnut.com","minorfigures.com",
        "boldbeanco.com","hunterandgatherfoods.com","grind.co.uk","unionroasted.com",
        "squaremilecoffee.com","origincoffee.co.uk","workshopcoffee.com","ozonecoffee.co.uk",
        "assemblycoffee.co.uk","climpsonandsons.com",
        # AU
        "sirthelabel.com","camillaandmarc.com","spell.co","becandbridge.com","gorman.com.au",
        "leemathews.com.au","cablemelbourne.com","misterzimi.com","sandandsky.com","nourishedlife.com.au",
        "moogoo.com.au","trilogyproducts.com.au","jurlique.com.au","ultraceuticals.com",
        "zinhome.com","koskela.com.au","lifely.com.au","designstuff.com.au",
        # CA
        "duer.ca","mackage.com","mooseknucklescanada.com","soiakyo.com","rudsak.com",
        "provinceofcanada.com","harlyjae.com","18waits.com","maguireshoes.com","ardene.com",
        "nakedandfamousdenim.com","moblerfurniture.com","skinfixinc.com","deciem.com",
        # NZ
        "rubynz.com","shjark.com","kathmandu.co.nz","worldbrand.co.nz","stolengirlfriendsclub.com",
        "icebreaker.com","karenwalker.com","essano.co.nz","ethique.co.nz","sundayhomestore.co.nz",
        "ecoya.co.nz","trilogyproducts.com",
        # EU
        "escada.com","bugatti-fashion.com","lavera.de","butlers.com","lamy.com",
        "embryolisse.fr","nuxe.com","sezane.com","pinko.com","albertaferretti.com",
        "borghese.com","alessi.com","diegodallapalma.com","scalperscompany.com","kinglouie.com",
        "scotch-soda.com","fabiennechapot.com","marie-stella-maris.com","toteme.com","verso.com",
        "sachajuan.com",
        # Asia
        "sokoglam.com","wishtrend.com","houseofmasaba.com","wforwoman.com","lakmeindia.com",
        "cottonink.co.id","sejauh.com","jaspal.com","greyhound.co.th","penshoppe.com",
        "plainsandprints.com","yame.vn","hermo.my","beyondthevines.com","nookandcranny.com",
        "keworganics.com","cloud10beauty.com","meagherspharmacy.ie","carrollsirishgifts.com",
        "susannekaufmann.com","benamor1925.com","castelbel.com","augarten.com","mastihashop.com",
        "korres.com","karmameju.com","northern.no","cathrinehammel.com","designhousestockholm.no",
        "lumene.com","aarikka.fi","ivanahelsinki.com",
    ],
}

def build_candidates():
    candidates = []
    seen = set()
    for cat, domains in BRANDS.items():
        for d in domains:
            d = d.strip().lower().replace(" ", "")
            if d not in seen and "." in d:
                seen.add(d)
                candidates.append({"domain": d, "category": cat, "subcategory": "curated", "source": "curated"})
    return candidates

def main():
    candidates = build_candidates()
    print(f"Candidates: {len(candidates)}")

    # Validate
    def check(c):
        try:
            req = urllib.request.Request(f"https://{c['domain']}/products.json",
                headers={"User-Agent":"BW/1","Accept":"application/json"})
            with urllib.request.urlopen(req, timeout=8) as r:
                if r.status == 200:
                    d = json.loads(r.read().decode())
                    if isinstance(d, dict) and "products" in d:
                        return c, True, len(d["products"])
                return c, False, ""
        except: return c, False, ""

    valid = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
        for f in concurrent.futures.as_completed({ex.submit(check, c): c for c in candidates}):
            c, ok, info = f.result()
            if ok: valid.append(c)

    cats = {}
    for v in valid: cats[v['category']] = cats.get(v['category'], 0) + 1
    print(f"Valid: {len(valid)}/{len(candidates)} ({len(valid)/len(candidates)*100:.1f}%)")
    for c,n in sorted(cats.items(), key=lambda x: -x[1])[:10]:
        print(f"  {c:25} {n:>4}")

    # Save merchants
    merchants = []
    for v in valid:
        d = v['domain'].lower(); slug = d.replace(".","").replace("-","")
        merchants.append({"domain": v['domain'], "source": f"shopify_{slug}",
            "country": "US", "currency": "USD", "category": v['category'],
            "source_attribution": "curated"})

    with open(MERCHANTS, "w") as f:
        json.dump({"description":"US Shopify merchant catalog — BUY-11037",
            "count":len(merchants),"merchants":merchants}, f, indent=2)

    print(f"Saved: {MERCHANTS} ({len(merchants)} merchants)")

if __name__ == "__main__":
    main()
