const fs = require("fs")
const path = require("path")
const ACME = require("acme-client")

ACME.setLogger(message => {
  console.log(message)
})

class CertificateMaker {
  constructor(app) {
    this.app = app
    this.challengeTokens = {}

    // Set up the HTTP challenge handler
    this.setupChallengeHandler()
  }

  setupChallengeHandler() {
    this.app.get("/.well-known/acme-challenge/:token", (req, res) => {
      const token = req.params.token
      const keyAuthorization = this.challengeTokens[token]

      if (keyAuthorization) {
        res.set("Content-Type", "text/plain")
        res.send(keyAuthorization)
      } else {
        res.status(404).send("Not Found")
      }
    })
    return this
  }

  log(domain, message) {
    console.log(`Make cert for: ${domain}. ${message}`)
  }

  async makeCertificate(domain, email, directory) {
    try {
      // Create account and domain private keys
      this.log(domain, "Creating private keys")
      const [accountKey, domainPrivateKey] = await Promise.all([ACME.crypto.createPrivateKey(), ACME.crypto.createPrivateKey()])
      this.log(domain, "Private keys created")

      // Create CSR
      const [csr, csrDer] = await ACME.crypto.createCsr(
        {
          altNames: [domain]
        },
        domainPrivateKey
      )
      this.log(domain, "CSR created")

      // Initialize ACME client
      const client = new ACME.Client({
        directoryUrl: ACME.directory.letsencrypt.production, // ACME.directory.letsencrypt.staging, //
        accountKey
      })

      this.log(domain, "client created")

      // Create a new account
      await client.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${email}`]
      })

      this.log(domain, "account created")

      // Create a new order
      const order = await client.createOrder({
        identifiers: [{ type: "dns", value: domain }]
      })
      this.log(domain, "order created")

      // Get authorizations
      const authorizations = await client.getAuthorizations(order)

      this.log(domain, "got auths")

      // Handle challenges
      for (const authz of authorizations) {
        const challenge = authz.challenges.find(c => c.type === "http-01")

        // Get key authorization
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge)

        this.log(domain, "got key")

        // Store the key authorization for the token
        this.challengeTokens[challenge.token] = keyAuthorization

        // Notify ACME server that the challenge is ready
        await client.verifyChallenge(authz, challenge)
        this.log(domain, "challenge verified")
        await client.completeChallenge(challenge)
        this.log(domain, "challenge completed")

        // Wait for the challenge to be validated
        await client.waitForValidStatus(challenge)
        this.log(domain, "challenge valid")

        // Remove the token after validation
        delete this.challengeTokens[challenge.token]
      }

      // Finalize the order
      await client.finalizeOrder(order, csr)

      this.log(domain, "order finalized")

      // Get the certificate
      const certificate = await client.getCertificate(order)

      this.log(domain, "got cert")

      // Ensure the directory exists
      fs.mkdirSync(directory, { recursive: true })

      // Save the certificate and private key
      fs.writeFileSync(path.join(directory, `${domain}.crt`), certificate)
      fs.writeFileSync(path.join(directory, `${domain}.key`), domainPrivateKey)

      this.log(domain, "wrote cert. SUCCESS!")
    } catch (error) {
      console.error(`An error occurred making cert for ${domain}`, error)
    }
  }
}

module.exports = { CertificateMaker }
