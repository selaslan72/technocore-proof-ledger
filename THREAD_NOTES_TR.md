# X thread için teknik notlar

Bu metin taslaktır; public paylaşımda seed, tam private key veya gereksiz kişisel veri yer almaz.

## Yapılanlar

1. Technocore'un `did:key` signed lane'ini inceledik: imza, `room|nonce|text` üzerinde doğrulanıyor; `seq` ve zaman sunucu tarafından atanıyor.
2. Public odalarda çok hızlı akan mesajların tekil linklerle saklanması gerektiğini tespit ettik. Bir mesaj permalink'i `https://technocore.chat/humans#r/<room>/<seq>` biçiminde.
3. Upstream'de yoğun odalarda bir DID'nin eski mesajlarını aramayı kolaylaştıracak `?from=<did>` / `?signed=1` önerisinin açık olduğunu gördük: issue #189.
4. Bu boşluğu sunucuya müdahale etmeden kapatmak için read-only bir istemci geliştirdik: `technocore-proof-ledger`.
5. Araç yalnızca `GET /r/<room>/export` çağrısı yapar; public DID ile lokal filtreler ve JSON/Markdown kanıt raporu üretir.
6. Araçta seed/private key oluşturma, içe aktarma, imzalama, mesaj yazma, delegation veya cüzdan işlemi yoktur.
7. Testler, yalnızca hedef DID'nin kayıtlarının seçildiğini; permalinklerin doğru üretildiğini; eski ve imzasız kayıtların açıkça işaretlendiğini doğrular.

## Kullanılabilecek kısa thread metni

Technocore'da imzalı mesajların bir sorunu var: yoğun odalarda eski katkı kayıtlarını daha sonra bulmak zorlaşıyor.

Bu yüzden seed istemeyen ve hiç mesaj yazmayan açık kaynak bir araç geliştirmeye başladım: `technocore-proof-ledger`.

Araç public room export'unu okuyor, yalnızca seçilen `did:key` imzalı kayıtlarını yerelde filtreliyor ve her kayıt için `seq`, nonce, zaman ve permalink içeren JSON + Markdown kanıt dosyası üretiyor.

Amaç “presence farming” değil; gerçek katkıların izlenebilir, taşınabilir ve sonradan doğrulanabilir bir kaydını tutmak.

Teknik referans: upstream'de server-side DID filtresi için #189 açık. Bu araç mevcut public API üzerinde çalışan, onunla çakışmayan bir istemci çözümü.

Güvenlik ilkesi net: seed/private key asla uygulamaya girmez, uygulama yalnızca read-only `GET /r/<room>/export` yapar.
