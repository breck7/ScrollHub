const acme = require("acme-client")
const fs = require("fs")
const http = require("http")

const makeCerts = async (email, domain) => {
  // Create account key
  const accountKey = await acme.openssl.createPrivateKey()

  // Create ACME client
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountKey
  })

  // Register account
  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: [`mailto:${email}`]
  })

  // Create domain private key and CSR
  const domainKey = await acme.openssl.createPrivateKey()
  const [csr, csrPem] = await acme.openssl.createCsr(
    {
      commonName: domain,
      altNames: [] // Add any additional domain names here
    },
    domainKey
  )

  // Create order
  const order = await client.createOrder({
    identifiers: [{ type: "dns", value: domain }]
  })

  // Get authorizations
  const authorizations = await client.getAuthorizations(order)

  // Process each authorization
  for (const authorization of authorizations) {
    const httpChallenge = authorization.challenges.find(challenge => challenge.type === "http-01")

    const keyAuthorization = await client.getChallengeKeyAuthorization(httpChallenge)
    const token = httpChallenge.token

    // Start HTTP server to serve the challenge
    const server = http.createServer((req, res) => {
      if (req.url === `/.well-known/acme-challenge/${token}`) {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end(keyAuthorization)
        console.log("Served key authorization")
      } else {
        res.writeHead(404)
        res.end("Not found")
      }
    })

    // Wait for the server to start listening
    await new Promise((resolve, reject) => {
      server.listen(80, async () => {
        console.log("HTTP server listening on port 80")

        try {
          // Notify ACME provider that challenge is ready
          await client.setChallengeAccepted(httpChallenge)

          // Wait for challenge to be validated
          await client.waitForValidStatus(httpChallenge)

          console.log("Challenge validated")
          resolve()
        } catch (e) {
          reject(e)
        } finally {
          // Close the server
          server.close()
          console.log("HTTP server closed")
        }
      })
    })
  }

  // Finalize order
  await client.finalizeOrder(order, csr)

  // Get certificate
  const certificate = await client.getCertificate(order)

  // Save certificate and domain key
  // fs.writeFileSync("certificate.crt", certificate)
  // fs.writeFileSync("private.key", domainKey)

  console.log("Certificate and key have been saved.")
  return {
    certificate,
    domainKey
  }
}

module.exports = { makeCerts }
