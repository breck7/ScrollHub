const fs = require("fs")
const path = require("path")
const ACME = require("acme-client")

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

  async makeCertificate(domain, email, directory) {
    try {
      // Create account and domain private keys
      const [accountKey, domainPrivateKey] = await Promise.all([ACME.crypto.createPrivateKey(), ACME.crypto.createPrivateKey()])

      // Create CSR
      const [csr, csrDer] = await ACME.crypto.createCsr(
        {
          commonName: domain
        },
        domainPrivateKey
      )

      // Initialize ACME client
      const client = new ACME.Client({
        directoryUrl: ACME.directory.letsencrypt.production,
        accountKey
      })

      // Create a new account
      await client.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${email}`]
      })

      // Create a new order
      const order = await client.createOrder({
        identifiers: [{ type: "dns", value: domain }]
      })
      console.log(`Order created for ${domain}`)

      // Get authorizations
      const authorizations = await client.getAuthorizations(order)

      console.log(`Auths got for ${domain}`)

      // Handle challenges
      for (const authz of authorizations) {
        const challenge = authz.challenges.find(c => c.type === "http-01")

        // Get key authorization
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge)

        console.log(`key auth got for ${domain}`)

        // Store the key authorization for the token
        this.challengeTokens[challenge.token] = keyAuthorization

        // Notify ACME server that the challenge is ready
        await client.verifyChallenge(authz, challenge)
        console.log(`challenge verified for ${domain}`)
        await client.completeChallenge(challenge)
        console.log(`challenge completed for ${domain}`)

        // Wait for the challenge to be validated
        await client.waitForValidStatus(challenge)
        console.log(`challenge valid for ${domain}`)

        // Remove the token after validation
        delete this.challengeTokens[challenge.token]
      }

      // Finalize the order
      await client.finalizeOrder(order, csr)

      console.log(`order finalized for ${domain}`)

      // Get the certificate
      const certificate = await client.getCertificate(order)

      console.log(`got certificate for ${domain}`)

      // Ensure the directory exists
      fs.mkdirSync(directory, { recursive: true })

      // Save the certificate and private key
      fs.writeFileSync(path.join(directory, `${domain}.crt`), certificate)
      fs.writeFileSync(path.join(directory, `${domain}.key`), domainPrivateKey)

      console.log("Certificate successfully obtained and saved!")
    } catch (error) {
      console.error(`An error occurred making cert for ${domain}`, error)
    }
  }
}

module.exports = { CertificateMaker }
