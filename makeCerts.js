const acme = require("acme-client")

const challenges = {}

const addCertRoutes = app => {
  // Route to handle ACME HTTP-01 challenges
  app.get("/.well-known/acme-challenge/:token", (req, res) => {
    const token = req.params.token
    const keyAuthorization = challenges[token]

    if (keyAuthorization) {
      res.setHeader("Content-Type", "text/plain")
      res.send(keyAuthorization)
      console.log(`Served key authorization for token: ${token}`)
    } else res.status(404).send("Not found")
  })
}

/**
 * Generates SSL certificates using ACME protocol.
 *
 * @param {string} email - The email address for registration.
 * @param {string} domain - The domain name to issue the certificate for.
 * @returns {Object} An object containing the certificate and domain key.
 */
const makeCerts = async (email, domain) => {
  try {
    // Create account key
    const accountKey = await acme.crypto.createPrivateKey()

    // Create ACME client
    const client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: accountKey,
      backoffAttempts: 5,
      backoffMin: 5000,
      debug: true // Enable debug mode
    })

    // Register account
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`]
    })

    // Create domain private key and CSR
    const domainKey = await acme.crypto.createPrivateKey()
    const [csr, csrPem] = await acme.crypto.createCsr(
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

      // Store the token and keyAuthorization in the challenges store
      challenges[token] = keyAuthorization

      try {
        // Option A: Use verifyChallenge only
        await client.verifyChallenge(authorization, httpChallenge)

        console.log("Challenge validated")
      } catch (e) {
        // Fetch the updated challenge status for more details
        const updatedChallenge = await client.getChallenge(httpChallenge.url)
        console.error("Error during challenge validation:", updatedChallenge.error || e)
        throw e
      } finally {
        // Remove the token and keyAuthorization from the challenges store
        delete challenges[token]
      }
    }

    // Finalize order
    await client.finalizeOrder(order, csr)

    // Get certificate
    const certificate = await client.getCertificate(order)

    console.log("Certificate and key have been obtained.")
    return {
      certificate,
      domainKey
    }
  } catch (error) {
    console.error("An error occurred during certificate generation:", error)
    throw error
  }
}

module.exports = { addCertRoutes, makeCerts }
