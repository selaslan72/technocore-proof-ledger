# X thread için teknik notlar

Bu metin taslaktır; public paylaşımda seed, tam private key veya gereksiz kişisel veri yer almaz.

## Yapılanlar

1. Technocore'un `did:key` signed lane'ini inceledik: imza, `room|nonce|text` üzerinde doğrulanıyor; `seq` ve zaman sunucu tarafından atanıyor.
2. Public odalarda çok hızlı akan mesajların tekil linklerle saklanması gerektiğini tespit ettik. Bir mesaj permalink'i `https://technocore.chat/humans#r/<room>/<seq>` biçiminde.
3. Upstream'de yoğun odalarda bir DID'nin eski mesajlarını aramayı kolaylaştıracak `?from=<did>` / `?signed=1` önerisinin açık olduğunu gördük: issue #189.
4. Bu boşluğu sunucuya müdahale etmeden kapatmak için read-only bir istemci geliştirdik: `technocore-proof-ledger`.
5. Kanıt raporu modu yalnızca `GET /r/<room>/export` çağrısı yapar; public DID ile lokal filtreler, export içindeki `room|nonce|text` Ed25519 imzasını yerelde tekrar doğrular ve JSON/Markdown kanıt raporu üretir.
6. Araçta seed/private key oluşturma, içe aktarma, imzalama, mesaj yazma, delegation veya cüzdan işlemi yoktur.
7. Testler, yalnızca hedef DID'nin kayıtlarının seçildiğini; permalinklerin doğru üretildiğini; eski ve imzasız kayıtların açıkça işaretlendiğini doğrular.
8. İkinci sürümde kullanıcı tam DID'yi elle yazmak zorunda değildir: kendi imzalı mesajının permalinkini verir. Araç linkteki kesin `seq` kaydını export içinden okur, geçerli imzayı yerelde doğrular, public DID'yi buradan çözer ve ardından raporu üretir.
9. Rapor artık kaynak export'un SHA-256 özetini ve byte boyutunu taşır. Ayrıca 19 haneli nonce'ları JavaScript sayı yuvarlamasına düşürmeden doğrular; mesaj gövdelerini Markdown'da veri olarak kod bloğuna alır.
10. `watch` modu, public `GET /r/<room>?since=<seq>&wait=<s>&format=json` okuyucusuyla gelecekteki mesajları yerel JSONL arşivine ekler. Kendi checkpoint'inden devam eder, retention nedeniyle önceden silinmiş mesajları geri getirmez ve hiçbir yazma endpoint'ini çağırmaz.

## Kullanılabilecek kısa thread metni

Technocore'da imzalı mesajların bir sorunu var: yoğun odalarda eski katkı kayıtlarını daha sonra bulmak zorlaşıyor.

Bu yüzden seed istemeyen ve hiç mesaj yazmayan açık kaynak bir araç geliştirmeye başladım: `technocore-proof-ledger`.

Araç public room export'unu okuyor, seçilen `did:key` kayıtlarını yerelde filtreliyor ve `sig` alanı olanları Technocore'un açık `room|nonce|text` Ed25519 formatına göre yeniden doğruluyor. Her kayıt için `seq`, nonce, zaman, permalink ve doğrulama sonucunu içeren JSON + Markdown kanıt dosyası üretiyor.

Amaç “presence farming” değil; gerçek katkıların izlenebilir, taşınabilir ve sonradan doğrulanabilir bir kaydını tutmak.

Teknik referans: upstream'de server-side DID filtresi için #189 açık. Bu araç mevcut public API üzerinde çalışan, onunla çakışmayan bir istemci çözümü.

Güvenlik ilkesi net: seed/private key asla uygulamaya girmez. Uygulama kanıt için read-only `GET /r/<room>/export`, gelecek kayıtları yerelde tutmak için de yine read-only room reader kullanır; hiçbir mesaj yazma endpoint'ine gitmez. Raporun kaynak export SHA-256'sı da yer alıyor; bu, raporu bir ödül/airdrop kanıtına dönüştürmez.

Yeni en basit komut: `node src/cli.mjs from-link --message-url '<imzalı-mesaj-linki>'`.
